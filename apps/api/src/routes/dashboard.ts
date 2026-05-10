import { Router, type Router as RouterType } from "express";
import prisma from "@repo/db";
import { requireAuth, type AuthUser } from "../auth";

export const dashboardRouter: RouterType = Router();

dashboardRouter.use(requireAuth);

dashboardRouter.get("/", async (_req, res) => {
  const user = res.locals.user as AuthUser;

  const [sales, purchases] = await Promise.all([
    prisma.negotiation.findMany({
      where: {
        sellerId: user.id,
        status: { in: ["accepted", "paying"] },
      },
      include: {
        product: { select: { id: true, title: true, askPrice: true, imageUrl: true, category: true } },
        buyer: { select: { id: true, name: true, email: true } },
        messages: { orderBy: { createdAt: "asc" } },
      },
      orderBy: { updatedAt: "desc" },
    }),
    prisma.negotiation.findMany({
      where: {
        buyerId: user.id,
        status: { in: ["accepted", "paying"] },
      },
      include: {
        product: { select: { id: true, title: true, askPrice: true, imageUrl: true, category: true } },
        seller: { select: { id: true, name: true, email: true } },
        messages: { orderBy: { createdAt: "asc" } },
      },
      orderBy: { updatedAt: "desc" },
    }),
  ]);

  return res.json({ sales, purchases });
});
