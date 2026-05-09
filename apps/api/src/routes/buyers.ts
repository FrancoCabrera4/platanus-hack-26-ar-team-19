import { Router, type Router as RouterType } from "express";
import { z } from "zod";
import prisma from "@repo/db";
import {
  runBuyerOnboardingTurn,
  type BuyerSearchDraft,
} from "../agents/buyer-onboarding";
import type { ChatTurn } from "../llm/gemini";

export const buyersRouter: RouterType = Router();

const StartConversation = z.object({ buyerId: z.string().uuid() });

// POST /buyers/conversations  — start a new onboarding chat
buyersRouter.post("/conversations", async (req, res) => {
  const parsed = StartConversation.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const buyer = await prisma.user.findUnique({ where: { id: parsed.data.buyerId } });
  if (!buyer) return res.status(404).json({ error: "buyer not found" });

  const turn = await runBuyerOnboardingTurn([], {});

  const conv = await prisma.buyerConversation.create({
    data: {
      buyerId: buyer.id,
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
});

const PostMessage = z.object({ content: z.string().min(1) });

// POST /buyers/conversations/:id/messages
buyersRouter.post("/conversations/:id/messages", async (req, res) => {
  const parsed = PostMessage.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const conv = await prisma.buyerConversation.findUnique({
    where: { id: req.params.id },
    include: { messages: { orderBy: { createdAt: "asc" } } },
  });
  if (!conv) return res.status(404).json({ error: "conversation not found" });
  if (conv.status === "completed") {
    return res.status(409).json({ error: "conversation already completed" });
  }

  await prisma.conversationMessage.create({
    data: { buyerConvId: conv.id, role: "user", content: parsed.data.content },
  });

  const history: ChatTurn[] = [
    ...conv.messages.map((m) => ({ role: m.role as ChatTurn["role"], content: m.content })),
    { role: "user", content: parsed.data.content },
  ];
  const state = JSON.parse(conv.state) as BuyerSearchDraft;

  const turn = await runBuyerOnboardingTurn(history, state);
  const merged: BuyerSearchDraft = { ...state, ...turn.state };

  await prisma.conversationMessage.create({
    data: { buyerConvId: conv.id, role: "assistant", content: turn.reply },
  });

  let searchId: string | undefined;

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
      data: {
        status: "completed",
        searchId: search.id,
        state: JSON.stringify(merged),
      },
    });
    searchId = search.id;
  } else {
    await prisma.buyerConversation.update({
      where: { id: conv.id },
      data: { state: JSON.stringify(merged) },
    });
  }

  return res.json({
    reply: turn.reply,
    state: merged,
    done: turn.done,
    searchId,
  });
});

// GET /buyers/conversations/:id
buyersRouter.get("/conversations/:id", async (req, res) => {
  const conv = await prisma.buyerConversation.findUnique({
    where: { id: req.params.id },
    include: { messages: { orderBy: { createdAt: "asc" } }, search: true },
  });
  if (!conv) return res.status(404).json({ error: "conversation not found" });
  return res.json({ ...conv, state: JSON.parse(conv.state) });
});
