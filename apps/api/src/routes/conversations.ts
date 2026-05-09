import { Router, type Router as RouterType } from "express";
import { z } from "zod";
import prisma from "@repo/db";
import { log } from "@repo/logger";
import {
  runBuyerOnboardingTurn,
  streamBuyerOnboardingTurn,
  type BuyerSearchDraft,
} from "../agents/buyer-onboarding";
import {
  runSellerOnboardingTurn,
  streamSellerOnboardingTurn,
  type SellerProductDraft,
} from "../agents/seller-onboarding";
import { enqueueRunSearch } from "../jobs/runner";
import type { ChatTurn } from "../llm/gemini";
import { upsertProductEmbedding } from "../services/embeddings";
import { requireAuth, type AuthUser } from "../auth";
import { asyncHandler, sseHeaders, sseSend } from "./_sse";

export const conversationsRouter: RouterType = Router();

const ConversationMode = z.enum(["buying", "posting_product"]);
const StartConversation = z.object({ mode: ConversationMode });
const PostMessage = z.object({
  content: z.string().min(1),
  imageUrl: z.string().min(1).optional(),
});

type ConversationMode = z.infer<typeof ConversationMode>;
type ConversationMessageRow = { role: string; content: string };
type DraftState = BuyerSearchDraft | SellerProductDraft;

const STATE_PREFIX = "__state__:";
const UNCAPPED_BUYER_MAX_PRICE = 1_000_000_000;

function currentUser(res: { locals: { user?: AuthUser } }): AuthUser {
  const user = res.locals.user;
  if (!user) throw new Error("Missing authenticated user");
  return user;
}

function visibleMessages(messages: ConversationMessageRow[]): ConversationMessageRow[] {
  return messages.filter((m) => m.role !== "system" || !m.content.startsWith(STATE_PREFIX));
}

function buildHistory(messages: ConversationMessageRow[], content: string): ChatTurn[] {
  return [
    ...visibleMessages(messages).map((m) => ({ role: m.role as ChatTurn["role"], content: m.content })),
    { role: "user", content },
  ];
}

function latestState<T extends DraftState>(messages: ConversationMessageRow[]): T {
  const raw = [...messages].reverse().find((m) => (
    m.role === "system" && m.content.startsWith(STATE_PREFIX)
  ))?.content.slice(STATE_PREFIX.length);

  if (!raw) return {} as T;

  try {
    return JSON.parse(raw) as T;
  } catch {
    return {} as T;
  }
}

function stateMessage(state: DraftState) {
  return { role: "system", content: `${STATE_PREFIX}${JSON.stringify(state)}` };
}

function normalizeBuyerMaxPrice(maxPrice: number | undefined): number {
  if (typeof maxPrice === "number" && Number.isFinite(maxPrice) && maxPrice > 0) {
    return maxPrice;
  }

  return UNCAPPED_BUYER_MAX_PRICE;
}

async function runTurn(
  mode: ConversationMode,
  history: ChatTurn[],
  state: DraftState,
) {
  if (mode === "buying") {
    return runBuyerOnboardingTurn(history, state as BuyerSearchDraft);
  }

  return runSellerOnboardingTurn(history, state as SellerProductDraft);
}

async function streamTurn(
  mode: ConversationMode,
  history: ChatTurn[],
  state: DraftState,
  onChunk: (text: string) => void,
) {
  if (mode === "buying") {
    return streamBuyerOnboardingTurn(history, state as BuyerSearchDraft, onChunk);
  }

  return streamSellerOnboardingTurn(history, state as SellerProductDraft, onChunk);
}

async function completeConversation(
  conversationId: string,
  userId: string,
  mode: ConversationMode,
  done: boolean,
  state: DraftState,
): Promise<{ productId?: string; searchId?: string; jobId?: string }> {
  if (!done) {
    await prisma.conversation.update({
      where: { id: conversationId },
      data: { status: "in_progress" },
    });
    return {};
  }

  if (mode === "posting_product") {
    const productState = state as SellerProductDraft;
    if (
      !productState.title ||
      !productState.description ||
      !productState.askPrice ||
      !productState.negotiationStrategy ||
      !productState.imageUrl
    ) {
      return {};
    }

    const product = await prisma.product.create({
      data: {
        userId,
        conversationId,
        title: productState.title,
        description: productState.description,
        category: productState.category ?? null,
        condition: productState.condition ?? null,
        askPrice: productState.askPrice,
        negotiationStrategy: productState.negotiationStrategy,
        imageUrl: productState.imageUrl,
      },
    });

    await upsertProductEmbedding(product.id, product).catch((err) => {
      log("Product embedding failed:", (err as Error).message);
    });

    await prisma.conversation.update({
      where: { id: conversationId },
      data: { status: "completed" },
    });
    return { productId: product.id };
  }

  const searchState = state as BuyerSearchDraft;
  if (!searchState.query || !searchState.negotiationStrategy) {
    return {};
  }
  const maxPrice = normalizeBuyerMaxPrice(searchState.maxPrice);

  const search = await prisma.buyerSearch.create({
    data: {
      buyerId: userId,
      conversationId,
      query: searchState.query,
      requirements: searchState.requirements ?? null,
      category: searchState.category ?? null,
      maxPrice,
      negotiationStrategy: searchState.negotiationStrategy,
      timeBudgetSeconds: searchState.timeBudgetSeconds ?? 120,
      status: "ready",
    },
  });
  await prisma.conversation.update({
    where: { id: conversationId },
    data: { status: "completed" },
  });

  const jobId = await enqueueRunSearch({ searchId: search.id });
  return { searchId: search.id, jobId };
}

conversationsRouter.use(requireAuth);

conversationsRouter.post("/", asyncHandler(async (req, res) => {
  const parsed = StartConversation.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const user = currentUser(res);
  const turn = await runTurn(parsed.data.mode, [], {});

  const conversation = await prisma.conversation.create({
    data: {
      userId: user.id,
      mode: parsed.data.mode,
      messages: {
        create: [
          { role: "assistant", content: turn.reply },
          stateMessage(turn.state),
        ],
      },
    },
    include: { messages: true },
  });

  return res.status(201).json({
    id: conversation.id,
    mode: conversation.mode,
    status: conversation.status,
    state: turn.state,
    done: turn.done,
    messages: visibleMessages(conversation.messages),
  });
}));

conversationsRouter.get("/", asyncHandler(async (req, res) => {
  const user = currentUser(res);
  const mode = ConversationMode.safeParse(req.query.mode).success
    ? (req.query.mode as ConversationMode)
    : undefined;

  const conversations = await prisma.conversation.findMany({
    where: { userId: user.id, ...(mode ? { mode } : {}) },
    orderBy: { createdAt: "desc" },
    include: {
      messages: { orderBy: { createdAt: "asc" } },
      product: { select: { id: true } },
      search: { select: { id: true } },
    },
  });

  return res.json(conversations.map((conversation) => {
    const preview = visibleMessages(conversation.messages)[0]?.content ?? "";
    return {
      id: conversation.id,
      mode: conversation.mode,
      status: conversation.status,
      productId: conversation.product?.id ?? null,
      searchId: conversation.search?.id ?? null,
      createdAt: conversation.createdAt,
      preview,
    };
  }));
}));

conversationsRouter.post("/:id/messages", asyncHandler(async (req, res) => {
  const parsed = PostMessage.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const user = currentUser(res);
  const conversation = await prisma.conversation.findUnique({
    where: { id: req.params.id },
    include: { messages: { orderBy: { createdAt: "asc" } } },
  });
  if (!conversation) return res.status(404).json({ error: "conversation not found" });
  if (conversation.userId !== user.id) return res.status(403).json({ error: "not_the_owner" });
  if (conversation.status === "completed") {
    return res.status(409).json({ error: "conversation already completed" });
  }

  await prisma.conversationMessage.create({
    data: { conversationId: conversation.id, role: "user", content: parsed.data.content },
  });

  const state = latestState(conversation.messages);
  const turn = await runTurn(
    conversation.mode as ConversationMode,
    buildHistory(conversation.messages, parsed.data.content),
    state,
  );
  const merged = {
    ...state,
    ...turn.state,
    ...(conversation.mode === "posting_product" && parsed.data.imageUrl ? { imageUrl: parsed.data.imageUrl } : {}),
  };

  await prisma.conversationMessage.createMany({
    data: [
      { conversationId: conversation.id, role: "assistant", content: turn.reply },
      { conversationId: conversation.id, ...stateMessage(merged) },
    ],
  });

  const completion = await completeConversation(
    conversation.id,
    user.id,
    conversation.mode as ConversationMode,
    turn.done,
    merged,
  );

  return res.json({ reply: turn.reply, state: merged, done: turn.done, ...completion });
}));

conversationsRouter.post("/:id/messages/stream", asyncHandler(async (req, res) => {
  const parsed = PostMessage.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const user = currentUser(res);
  const conversation = await prisma.conversation.findUnique({
    where: { id: req.params.id },
    include: { messages: { orderBy: { createdAt: "asc" } } },
  });
  if (!conversation) return res.status(404).json({ error: "conversation not found" });
  if (conversation.userId !== user.id) return res.status(403).json({ error: "not_the_owner" });
  if (conversation.status === "completed") {
    return res.status(409).json({ error: "conversation already completed" });
  }

  sseHeaders(res);

  try {
    await prisma.conversationMessage.create({
      data: { conversationId: conversation.id, role: "user", content: parsed.data.content },
    });

    const state = latestState(conversation.messages);
    const turn = await streamTurn(
      conversation.mode as ConversationMode,
      buildHistory(conversation.messages, parsed.data.content),
      state,
      (chunk) => sseSend(res, { chunk }),
    );
    const merged = {
      ...state,
      ...turn.state,
      ...(conversation.mode === "posting_product" && parsed.data.imageUrl ? { imageUrl: parsed.data.imageUrl } : {}),
    };

    await prisma.conversationMessage.createMany({
      data: [
        { conversationId: conversation.id, role: "assistant", content: turn.reply },
        { conversationId: conversation.id, ...stateMessage(merged) },
      ],
    });

    const completion = await completeConversation(
      conversation.id,
      user.id,
      conversation.mode as ConversationMode,
      turn.done,
      merged,
    );

    sseSend(res, { done: true, state: merged, ...completion });
  } catch (err) {
    sseSend(res, { error: (err as Error).message });
  }
  res.end();
}));

conversationsRouter.get("/:id", asyncHandler(async (req, res) => {
  const user = currentUser(res);
  const conversation = await prisma.conversation.findUnique({
    where: { id: req.params.id },
    include: {
      messages: { orderBy: { createdAt: "asc" } },
      product: true,
      search: true,
    },
  });
  if (!conversation) return res.status(404).json({ error: "conversation not found" });
  if (conversation.userId !== user.id) return res.status(403).json({ error: "not_the_owner" });

  return res.json({
    ...conversation,
    state: latestState(conversation.messages),
    messages: visibleMessages(conversation.messages),
  });
}));
