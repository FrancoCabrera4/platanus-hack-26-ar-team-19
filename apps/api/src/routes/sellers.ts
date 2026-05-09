import { Router, type Router as RouterType } from "express";
import { z } from "zod";
import prisma from "@repo/db";
import {
  runSellerOnboardingTurn,
  streamSellerOnboardingTurn,
  type SellerListingDraft,
} from "../agents/seller-onboarding";
import type { ChatTurn } from "../llm/gemini";
import { asyncHandler, sseHeaders, sseSend } from "./_sse";
import { requireAuth, requireVerifiedEmail, type AuthUser } from "../auth";

export const sellersRouter: RouterType = Router();

const StartConversation = z.object({ sellerId: z.string().uuid().optional() });
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

sellersRouter.use(requireAuth, requireVerifiedEmail);

// POST /sellers/conversations — start a new onboarding chat
sellersRouter.post("/conversations", asyncHandler(async (req, res) => {
  const parsed = StartConversation.safeParse(req.body ?? {});
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const user = currentUser(res);
  if (parsed.data.sellerId && parsed.data.sellerId !== user.id) {
    return res.status(403).json({ error: "not_the_owner" });
  }

  const turn = await runSellerOnboardingTurn([], {});

  const conv = await prisma.sellerConversation.create({
    data: {
      sellerId: user.id,
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

// POST /sellers/conversations/:id/messages
sellersRouter.post("/conversations/:id/messages", asyncHandler(async (req, res) => {
  const parsed = PostMessage.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const user = currentUser(res);
  const conv = await prisma.sellerConversation.findUnique({
    where: { id: req.params.id },
    include: { messages: { orderBy: { createdAt: "asc" } } },
  });
  if (!conv) return res.status(404).json({ error: "conversation not found" });
  if (conv.sellerId !== user.id) return res.status(403).json({ error: "not_the_owner" });
  if (conv.status === "completed") {
    return res.status(409).json({ error: "conversation already completed" });
  }

  await prisma.conversationMessage.create({
    data: { sellerConvId: conv.id, role: "user", content: parsed.data.content },
  });

  const state = JSON.parse(conv.state) as SellerListingDraft;
  const turn = await runSellerOnboardingTurn(buildHistory(conv.messages, parsed.data.content), state);
  const merged: SellerListingDraft = { ...state, ...turn.state };

  await prisma.conversationMessage.create({
    data: { sellerConvId: conv.id, role: "assistant", content: turn.reply },
  });

  let listingId: string | undefined;
  if (turn.done && merged.title && merged.description && merged.askPrice && merged.minPrice) {
    const listing = await prisma.listing.create({
      data: {
        sellerId: conv.sellerId,
        title: merged.title,
        description: merged.description,
        category: merged.category ?? null,
        condition: merged.condition ?? null,
        askPrice: merged.askPrice,
        minPrice: merged.minPrice,
        maxPrice: merged.maxPrice ?? null,
        strategyNotes: merged.strategyNotes ?? null,
      },
    });
    await prisma.sellerConversation.update({
      where: { id: conv.id },
      data: { status: "completed", listingId: listing.id, state: JSON.stringify(merged) },
    });
    listingId = listing.id;
  } else {
    await prisma.sellerConversation.update({
      where: { id: conv.id },
      data: { state: JSON.stringify(merged) },
    });
  }

  return res.json({ reply: turn.reply, state: merged, done: turn.done, listingId });
}));

// POST /sellers/conversations/:id/messages/stream — SSE streaming
sellersRouter.post("/conversations/:id/messages/stream", asyncHandler(async (req, res) => {
  const parsed = PostMessage.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const user = currentUser(res);
  const conv = await prisma.sellerConversation.findUnique({
    where: { id: req.params.id },
    include: { messages: { orderBy: { createdAt: "asc" } } },
  });
  if (!conv) return res.status(404).json({ error: "conversation not found" });
  if (conv.sellerId !== user.id) return res.status(403).json({ error: "not_the_owner" });
  if (conv.status === "completed") {
    return res.status(409).json({ error: "conversation already completed" });
  }

  sseHeaders(res);

  try {
    await prisma.conversationMessage.create({
      data: { sellerConvId: conv.id, role: "user", content: parsed.data.content },
    });

    const state = JSON.parse(conv.state) as SellerListingDraft;
    const turn = await streamSellerOnboardingTurn(
      buildHistory(conv.messages, parsed.data.content),
      state,
      (chunk) => sseSend(res, { chunk }),
    );
    const merged: SellerListingDraft = { ...state, ...turn.state };

    await prisma.conversationMessage.create({
      data: { sellerConvId: conv.id, role: "assistant", content: turn.reply },
    });

    let listingId: string | undefined;
    if (turn.done && merged.title && merged.description && merged.askPrice && merged.minPrice) {
      const listing = await prisma.listing.create({
        data: {
          sellerId: conv.sellerId,
          title: merged.title,
          description: merged.description,
          category: merged.category ?? null,
          condition: merged.condition ?? null,
          askPrice: merged.askPrice,
          minPrice: merged.minPrice,
          maxPrice: merged.maxPrice ?? null,
          strategyNotes: merged.strategyNotes ?? null,
        },
      });
      await prisma.sellerConversation.update({
        where: { id: conv.id },
        data: { status: "completed", listingId: listing.id, state: JSON.stringify(merged) },
      });
      listingId = listing.id;
    } else {
      await prisma.sellerConversation.update({
        where: { id: conv.id },
        data: { state: JSON.stringify(merged) },
      });
    }

    sseSend(res, { done: true, state: merged, listingId });
  } catch (err) {
    sseSend(res, { error: (err as Error).message });
  }
  res.end();
}));

// GET /sellers/conversations/:id
sellersRouter.get("/conversations/:id", asyncHandler(async (req, res) => {
  const user = currentUser(res);
  const conv = await prisma.sellerConversation.findUnique({
    where: { id: req.params.id },
    include: { messages: { orderBy: { createdAt: "asc" } }, listing: true },
  });
  if (!conv) return res.status(404).json({ error: "conversation not found" });
  if (conv.sellerId !== user.id) return res.status(403).json({ error: "not_the_owner" });
  return res.json({ ...conv, state: JSON.parse(conv.state) });
}));
