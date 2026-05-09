import { Router, type Router as RouterType } from "express";
import { z } from "zod";
import prisma from "@repo/db";
import {
  runSellerOnboardingTurn,
  streamSellerOnboardingTurn,
  type SellerListingDraft,
} from "../agents/seller-onboarding";
import type { ChatTurn } from "../llm/gemini";
import { sseHeaders, sseSend, streamWords, asyncHandler } from "./_sse";

export const sellersRouter: RouterType = Router();

const StartConversation = z.object({
  sellerId: z.string().uuid(),
});

// POST /sellers/conversations  — start a new onboarding chat (greeting only)
sellersRouter.post("/conversations", asyncHandler(async (req, res) => {
  const parsed = StartConversation.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const seller = await prisma.user.findUnique({ where: { id: parsed.data.sellerId } });
  if (!seller) return res.status(404).json({ error: "seller not found" });

  // Run an empty turn so the assistant produces an opening question.
  const turn = await runSellerOnboardingTurn([], {});

  const conv = await prisma.sellerConversation.create({
    data: {
      sellerId: seller.id,
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

const PostMessage = z.object({ content: z.string().min(1) });

// POST /sellers/conversations/:id/messages — user sends a message, get assistant reply
sellersRouter.post("/conversations/:id/messages", asyncHandler(async (req, res) => {
  const parsed = PostMessage.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const conv = await prisma.sellerConversation.findUnique({
    where: { id: req.params.id },
    include: { messages: { orderBy: { createdAt: "asc" } } },
  });
  if (!conv) return res.status(404).json({ error: "conversation not found" });
  if (conv.status === "completed") {
    return res.status(409).json({ error: "conversation already completed" });
  }

  await prisma.conversationMessage.create({
    data: { sellerConvId: conv.id, role: "user", content: parsed.data.content },
  });

  const history: ChatTurn[] = [
    ...conv.messages.map((m) => ({ role: m.role as ChatTurn["role"], content: m.content })),
    { role: "user", content: parsed.data.content },
  ];
  const state = JSON.parse(conv.state) as SellerListingDraft;

  const turn = await runSellerOnboardingTurn(history, state);

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
      data: {
        status: "completed",
        listingId: listing.id,
        state: JSON.stringify(merged),
      },
    });
    listingId = listing.id;
  } else {
    await prisma.sellerConversation.update({
      where: { id: conv.id },
      data: { state: JSON.stringify(merged) },
    });
  }

  return res.json({
    reply: turn.reply,
    state: merged,
    done: turn.done,
    listingId,
  });
}));

// POST /sellers/conversations/:id/messages/stream — same as /messages but SSE.
sellersRouter.post("/conversations/:id/messages/stream", asyncHandler(async (req, res) => {
  const parsed = PostMessage.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const conv = await prisma.sellerConversation.findUnique({
    where: { id: req.params.id },
    include: { messages: { orderBy: { createdAt: "asc" } } },
  });
  if (!conv) return res.status(404).json({ error: "conversation not found" });
  if (conv.status === "completed") {
    return res.status(409).json({ error: "conversation already completed" });
  }

  sseHeaders(res);

  try {
    await prisma.conversationMessage.create({
      data: { sellerConvId: conv.id, role: "user", content: parsed.data.content },
    });

    const history: ChatTurn[] = [
      ...conv.messages.map((m) => ({ role: m.role as ChatTurn["role"], content: m.content })),
      { role: "user", content: parsed.data.content },
    ];
    const state = JSON.parse(conv.state) as SellerListingDraft;

    const turn = await runSellerOnboardingTurn(history, state);
    const merged: SellerListingDraft = { ...state, ...turn.state };

    await prisma.conversationMessage.create({
      data: { sellerConvId: conv.id, role: "assistant", content: turn.reply },
    });

    await streamWords(res, turn.reply);

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
        data: {
          status: "completed",
          listingId: listing.id,
          state: JSON.stringify(merged),
        },
      });
      listingId = listing.id;
    } else {
      await prisma.sellerConversation.update({
        where: { id: conv.id },
        data: { state: JSON.stringify(merged) },
      });
    }

    sseSend(res, { done: true, state: merged, listingId });
    res.end();
  } catch (err) {
    sseSend(res, { error: (err as Error).message });
    res.end();
  }
}));

// POST /sellers/conversations/:id/messages/stream — SSE streaming
sellersRouter.post("/conversations/:id/messages/stream", async (req, res) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");

  const parsed = PostMessage.safeParse(req.body);
  if (!parsed.success) {
    res.write(`data: ${JSON.stringify({ error: "invalid input" })}\n\n`);
    return res.end();
  }

  const conv = await prisma.sellerConversation.findUnique({
    where: { id: req.params.id },
    include: { messages: { orderBy: { createdAt: "asc" } } },
  });
  if (!conv) {
    res.write(`data: ${JSON.stringify({ error: "conversation not found" })}\n\n`);
    return res.end();
  }
  if (conv.status === "completed") {
    res.write(`data: ${JSON.stringify({ error: "conversation already completed" })}\n\n`);
    return res.end();
  }

  await prisma.conversationMessage.create({
    data: { sellerConvId: conv.id, role: "user", content: parsed.data.content },
  });

  const history: ChatTurn[] = [
    ...conv.messages.map((m) => ({ role: m.role as ChatTurn["role"], content: m.content })),
    { role: "user", content: parsed.data.content },
  ];
  const state = JSON.parse(conv.state) as SellerListingDraft;

  try {
    const turn = await streamSellerOnboardingTurn(history, state, (chunk) => {
      res.write(`data: ${JSON.stringify({ chunk })}\n\n`);
    });

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

    res.write(`data: ${JSON.stringify({ done: true, state: merged, listingId })}\n\n`);
  } catch (err) {
    res.write(`data: ${JSON.stringify({ error: (err as Error).message })}\n\n`);
  }
  res.end();
});

// GET /sellers/conversations/:id
sellersRouter.get("/conversations/:id", asyncHandler(async (req, res) => {
  const conv = await prisma.sellerConversation.findUnique({
    where: { id: req.params.id },
    include: { messages: { orderBy: { createdAt: "asc" } }, listing: true },
  });
  if (!conv) return res.status(404).json({ error: "conversation not found" });
  return res.json({
    ...conv,
    state: JSON.parse(conv.state),
  });
}));
