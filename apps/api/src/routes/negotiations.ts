import { Router, type Router as RouterType } from "express";
import prisma from "@repo/db";
import { requireAuth, type AuthUser } from "../auth";

export const negotiationsRouter: RouterType = Router();

negotiationsRouter.use(requireAuth);

negotiationsRouter.get("/:id", async (req, res) => {
  const user = res.locals.user as AuthUser;
  const neg = await prisma.negotiation.findUnique({
    where: { id: req.params.id },
    include: {
      messages: { orderBy: { createdAt: "asc" } },
      product: { select: { id: true, title: true, askPrice: true } },
      search: { select: { buyerId: true } },
    },
  });
  if (!neg) return res.status(404).json({ error: "negotiation not found" });
  if (neg.search.buyerId !== user.id)
    return res.status(403).json({ error: "not_the_owner" });
  return res.json(neg);
});

// POST /negotiations/:id/accept - buyer confirms an awaiting_buyer agreement.
// Locks the product as sold inside a transaction so two confirmations can't both win.
negotiationsRouter.post("/:id/accept", async (req, res) => {
  const user = res.locals.user as AuthUser;
  const neg = await prisma.negotiation.findUnique({
    where: { id: req.params.id },
    include: {
      search: { select: { buyerId: true, maxPrice: true } },
    },
  });
  if (!neg) return res.status(404).json({ error: "negotiation not found" });
  if (neg.search.buyerId !== user.id)
    return res.status(403).json({ error: "not_the_owner" });
  if (neg.status !== "awaiting_buyer") {
    return res.status(409).json({ error: "not_awaiting_buyer" });
  }
  if (neg.finalPrice == null) {
    return res.status(409).json({ error: "missing_final_price" });
  }

  const outcome = await prisma.$transaction(async (tx) => {
    const fresh = await tx.product.findUnique({ where: { id: neg.productId } });
    if (!fresh || fresh.status !== "active") {
      await tx.negotiation.update({
        where: { id: neg.id },
        data: {
          status: "rejected",
          successful: false,
          reason: "Product was sold or withdrawn before buyer confirmation.",
          completedAt: new Date(),
        },
      });
      return { ok: false as const, code: "product_unavailable" };
    }
    const finalPrice = Math.min(neg.finalPrice!, fresh.askPrice);
    if (finalPrice > neg.search.maxPrice) {
      await tx.negotiation.update({
        where: { id: neg.id },
        data: {
          status: "rejected",
          successful: false,
          reason: "Final price above buyer ceiling (safety check).",
          completedAt: new Date(),
        },
      });
      return { ok: false as const, code: "over_budget" };
    }
    await tx.product.update({
      where: { id: neg.productId },
      data: { status: "sold" },
    });
    const updated = await tx.negotiation.update({
      where: { id: neg.id },
      data: {
        status: "accepted",
        successful: true,
        finalPrice,
        completedAt: new Date(),
      },
      include: {
        messages: { orderBy: { createdAt: "asc" } },
        product: { select: { id: true, title: true, askPrice: true } },
      },
    });
    return { ok: true as const, neg: updated };
  });

  if (!outcome.ok) {
    return res.status(409).json({ error: outcome.code });
  }
  return res.json(outcome.neg);
});

// POST /negotiations/:id/reject - buyer declines an awaiting_buyer agreement.
negotiationsRouter.post("/:id/reject", async (req, res) => {
  const user = res.locals.user as AuthUser;
  const neg = await prisma.negotiation.findUnique({
    where: { id: req.params.id },
    include: { search: { select: { buyerId: true } } },
  });
  if (!neg) return res.status(404).json({ error: "negotiation not found" });
  if (neg.search.buyerId !== user.id)
    return res.status(403).json({ error: "not_the_owner" });
  if (neg.status !== "awaiting_buyer") {
    return res.status(409).json({ error: "negotiation_not_awaiting_buyer" });
  }

  const updated = await prisma.negotiation.update({
    where: { id: neg.id },
    data: {
      status: "rejected",
      successful: false,
      finalPrice: null,
      reason: "Buyer declined the agreed price.",
      completedAt: new Date(),
    },
  });
  return res.json(updated);
});
