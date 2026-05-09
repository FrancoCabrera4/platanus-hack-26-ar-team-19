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
  if (neg.search.buyerId !== user.id) return res.status(403).json({ error: "not_the_owner" });
  return res.json(neg);
});
