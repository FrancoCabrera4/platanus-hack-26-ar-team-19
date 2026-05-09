import { Router, type Router as RouterType } from "express";
import prisma from "@repo/db";

export const listingsRouter: RouterType = Router();

// Public listing view excludes minPrice / strategyNotes (private to seller).
function publicListing<T extends { minPrice: number; strategyNotes: string | null }>(l: T) {
  const { minPrice: _min, strategyNotes: _strat, ...rest } = l;
  return rest;
}

listingsRouter.get("/", async (req, res) => {
  const status = (req.query.status as string | undefined) ?? "active";
  const category = req.query.category as string | undefined;
  const listings = await prisma.listing.findMany({
    where: {
      status,
      ...(category ? { category } : {}),
    },
    orderBy: { createdAt: "desc" },
  });
  return res.json(listings.map(publicListing));
});

listingsRouter.get("/:id", async (req, res) => {
  const listing = await prisma.listing.findUnique({ where: { id: req.params.id } });
  if (!listing) return res.status(404).json({ error: "listing not found" });
  return res.json(publicListing(listing));
});

// Owner-only view with private fields included.
listingsRouter.get("/:id/private", async (req, res) => {
  const sellerId = req.query.sellerId as string | undefined;
  if (!sellerId) return res.status(400).json({ error: "sellerId query required" });
  const listing = await prisma.listing.findUnique({ where: { id: req.params.id } });
  if (!listing) return res.status(404).json({ error: "listing not found" });
  if (listing.sellerId !== sellerId) return res.status(403).json({ error: "not the owner" });
  return res.json(listing);
});
