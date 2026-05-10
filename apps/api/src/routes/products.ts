import { Router, type Router as RouterType } from "express";
import prisma from "@repo/db";
import { getAuthUser, requireAuth } from "../auth";

export const productsRouter: RouterType = Router();

function publicProduct<T extends { negotiationStrategy: string | null }>(product: T) {
  const { negotiationStrategy: _strategy, ...rest } = product;
  return rest;
}

productsRouter.get("/", async (req, res) => {
  res.set("Cache-Control", "no-store");
  const status = (req.query.status as string | undefined) ?? "active";
  const category = req.query.category as string | undefined;
  const rawLimit = Number(req.query.limit);
  const rawOffset = Number(req.query.offset);
  const take = Number.isFinite(rawLimit)
    ? Math.min(Math.max(Math.trunc(rawLimit), 1), 100)
    : undefined;
  const skip = Number.isFinite(rawOffset)
    ? Math.max(Math.trunc(rawOffset), 0)
    : undefined;
  const products = await prisma.product.findMany({
    where: {
      status,
      ...(category ? { category } : {}),
    },
    orderBy: { createdAt: "desc" },
    ...(take ? { take } : {}),
    ...(skip ? { skip } : {}),
  });
  return res.json(products.map(publicProduct));
});

productsRouter.get("/:id", async (req, res) => {
  const product = await prisma.product.findUnique({ where: { id: req.params.id } });
  if (!product) return res.status(404).json({ error: "product not found" });
  return res.json(publicProduct(product));
});

productsRouter.get("/:id/private", requireAuth, async (req, res) => {
  const user = await getAuthUser(req);
  if (!user) return res.status(401).json({ error: "unauthorized" });

  const product = await prisma.product.findUnique({ where: { id: req.params.id } });
  if (!product) return res.status(404).json({ error: "product not found" });
  if (product.userId !== user.id) return res.status(403).json({ error: "not_the_owner" });

  return res.json(product);
});
