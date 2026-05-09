import { Router, type Router as RouterType } from "express";
import { z } from "zod";
import prisma from "@repo/db";
import {
  runBuyerOnboardingTurn,
  streamBuyerOnboardingTurn,
  type BuyerSearchDraft,
} from "../agents/buyer-onboarding";
import type { ChatTurn } from "../llm/gemini";
import { enqueueRunSearch } from "../jobs/runner";
import { asyncHandler, sseHeaders, sseSend } from "./_sse";
import { requireAuth, type AuthUser } from "../auth";

export const buyersRouter: RouterType = Router();

const StartConversation = z.object({ buyerId: z.string().uuid().optional() });
const PostMessage = z.object({ content: z.string().min(1) });

type ConversationMessageRow = { role: string; content: string };

function currentUser(res: { locals: { user?: AuthUser } }): AuthUser {
  const user = res.locals.user;
  if (!user) throw new Error("Missing authenticated user");
  return user;
}

function buildHistory(messages: ConversationMessageRow[], content: string): ChatTurn[] {
  return [
    ...messages.map((m) => ({ role: m.role as ChatTurn["role"], content: m.content })),
    { role: "user", content },
  ];
}

buyersRouter.use(requireAuth);

// POST /buyers/conversations — start a new onboarding chat
buyersRouter.post("/conversations", asyncHandler(async (req, res) => {
  const parsed = StartConversation.safeParse(req.body ?? {});
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const user = currentUser(res);
  if (parsed.data.buyerId && parsed.data.buyerId !== user.id) {
    return res.status(403).json({ error: "not_the_owner" });
  }

  const turn = await runBuyerOnboardingTurn([], {});

  const conv = await prisma.buyerConversation.create({
    data: {
      buyerId: user.id,
      state: JSON.stringify(turn.state),
      messages: {
        create: { role: "assistant", content: turn.reply },
      },
    },
    include: { messages: true },
  });

  return res.status(201).json({
    id: conv.id,
    status: conv.status,
    state: turn.state,
    done: turn.done,
    messages: conv.messages,
  });
}));

// POST /buyers/conversations/:id/messages
buyersRouter.post("/conversations/:id/messages", asyncHandler(async (req, res) => {
  const parsed = PostMessage.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const user = currentUser(res);
  const conv = await prisma.buyerConversation.findUnique({
    where: { id: req.params.id },
    include: { messages: { orderBy: { createdAt: "asc" } } },
  });
  if (!conv) return res.status(404).json({ error: "conversation not found" });
  if (conv.buyerId !== user.id) return res.status(403).json({ error: "not_the_owner" });
  if (conv.status === "completed") {
    return res.status(409).json({ error: "conversation already completed" });
  }

  await prisma.conversationMessage.create({
    data: { buyerConvId: conv.id, role: "user", content: parsed.data.content },
  });

  const state = JSON.parse(conv.state) as BuyerSearchDraft;
  const turn = await runBuyerOnboardingTurn(buildHistory(conv.messages, parsed.data.content), state);
  const merged: BuyerSearchDraft = { ...state, ...turn.state };

  await prisma.conversationMessage.create({
    data: { buyerConvId: conv.id, role: "assistant", content: turn.reply },
  });

  let searchId: string | undefined;
  let jobId: string | undefined;

  if (turn.done && merged.query && merged.maxPrice) {
    const search = await prisma.buyerSearch.create({
      data: {
        buyerId: conv.buyerId,
        query: merged.query,
        requirements: merged.requirements ?? null,
        category: merged.category ?? null,
        minPrice: merged.minPrice ?? null,
        maxPrice: merged.maxPrice,
        timeBudgetSeconds: merged.timeBudgetSeconds ?? 120,
        status: "ready",
      },
    });
    await prisma.buyerConversation.update({
      where: { id: conv.id },
      data: { status: "completed", searchId: search.id, state: JSON.stringify(merged) },
    });
    searchId = search.id;
    jobId = await enqueueRunSearch({ searchId: search.id });
  } else {
    await prisma.buyerConversation.update({
      where: { id: conv.id },
      data: { state: JSON.stringify(merged) },
    });
  }

  return res.json({ reply: turn.reply, state: merged, done: turn.done, searchId, jobId });
}));

// POST /buyers/conversations/:id/messages/stream — SSE streaming.
buyersRouter.post("/conversations/:id/messages/stream", asyncHandler(async (req, res) => {
  const parsed = PostMessage.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const user = currentUser(res);
  const conv = await prisma.buyerConversation.findUnique({
    where: { id: req.params.id },
    include: { messages: { orderBy: { createdAt: "asc" } } },
  });
  if (!conv) return res.status(404).json({ error: "conversation not found" });
  if (conv.buyerId !== user.id) return res.status(403).json({ error: "not_the_owner" });
  if (conv.status === "completed") {
    return res.status(409).json({ error: "conversation already completed" });
  }

  sseHeaders(res);

  try {
    await prisma.conversationMessage.create({
      data: { buyerConvId: conv.id, role: "user", content: parsed.data.content },
    });

    const state = JSON.parse(conv.state) as BuyerSearchDraft;
    const turn = await streamBuyerOnboardingTurn(
      buildHistory(conv.messages, parsed.data.content),
      state,
      (chunk) => sseSend(res, { chunk }),
    );
    const merged: BuyerSearchDraft = { ...state, ...turn.state };

    await prisma.conversationMessage.create({
      data: { buyerConvId: conv.id, role: "assistant", content: turn.reply },
    });

    let searchId: string | undefined;
    let jobId: string | undefined;
    if (turn.done && merged.query && merged.maxPrice) {
      const search = await prisma.buyerSearch.create({
        data: {
          buyerId: conv.buyerId,
          query: merged.query,
          requirements: merged.requirements ?? null,
          category: merged.category ?? null,
          minPrice: merged.minPrice ?? null,
          maxPrice: merged.maxPrice,
          timeBudgetSeconds: merged.timeBudgetSeconds ?? 120,
          status: "ready",
        },
      });
      await prisma.buyerConversation.update({
        where: { id: conv.id },
        data: { status: "completed", searchId: search.id, state: JSON.stringify(merged) },
      });
      searchId = search.id;
      jobId = await enqueueRunSearch({ searchId: search.id });
    } else {
      await prisma.buyerConversation.update({
        where: { id: conv.id },
        data: { state: JSON.stringify(merged) },
      });
    }

    sseSend(res, { done: true, state: merged, searchId, jobId });
  } catch (err) {
    sseSend(res, { error: (err as Error).message });
  }
  res.end();
}));

// GET /buyers/conversations — list all conversations for the current user
buyersRouter.get("/conversations", asyncHandler(async (req, res) => {
  const user = currentUser(res);
  const convs = await prisma.buyerConversation.findMany({
    where: { buyerId: user.id },
    orderBy: { createdAt: "desc" },
    include: {
      messages: { orderBy: { createdAt: "asc" }, take: 1 },
    },
  });
  return res.json(convs.map((c) => ({
    id: c.id,
    status: c.status,
    searchId: c.searchId,
    createdAt: c.createdAt,
    preview: c.messages[0]?.content ?? "",
  })));
}));

// GET /buyers/conversations/:id
buyersRouter.get("/conversations/:id", asyncHandler(async (req, res) => {
  const user = currentUser(res);
  const conv = await prisma.buyerConversation.findUnique({
    where: { id: req.params.id },
    include: { messages: { orderBy: { createdAt: "asc" } }, search: true },
  });
  if (!conv) return res.status(404).json({ error: "conversation not found" });
  if (conv.buyerId !== user.id) return res.status(403).json({ error: "not_the_owner" });
  return res.json({ ...conv, state: JSON.parse(conv.state) });
}));
