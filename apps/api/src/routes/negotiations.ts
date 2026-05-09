import { Router, type Router as RouterType } from "express";
import prisma from "@repo/db";

export const negotiationsRouter: RouterType = Router();

negotiationsRouter.get("/:id", async (req, res) => {
  const neg = await prisma.negotiation.findUnique({
    where: { id: req.params.id },
    include: {
      messages: { orderBy: { createdAt: "asc" } },
      listing: { select: { id: true, title: true, askPrice: true } },
      deal: true,
    },
  });
  if (!neg) return res.status(404).json({ error: "negotiation not found" });
  return res.json(neg);
});
