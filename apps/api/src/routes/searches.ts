import { Router, type Router as RouterType } from "express";
import prisma from "@repo/db";
import { enqueueRunSearch } from "../jobs/runner";

export const searchesRouter: RouterType = Router();

// POST /searches/:id/run — kick off async match + negotiate pipeline
searchesRouter.post("/:id/run", async (req, res) => {
  const search = await prisma.buyerSearch.findUnique({ where: { id: req.params.id } });
  if (!search) return res.status(404).json({ error: "search not found" });
  if (search.status === "running") {
    return res.status(409).json({ error: "search already running" });
  }
  if (search.status === "completed") {
    return res.status(409).json({ error: "search already completed" });
  }

  const jobId = await enqueueRunSearch({ searchId: search.id });
  return res.status(202).json({ jobId, searchId: search.id });
});

// GET /searches/:id — current state + deals
searchesRouter.get("/:id", async (req, res) => {
  const search = await prisma.buyerSearch.findUnique({
    where: { id: req.params.id },
    include: {
      negotiations: {
        include: { listing: { select: { id: true, title: true, askPrice: true } } },
      },
      deals: true,
      jobs: { orderBy: { createdAt: "desc" }, take: 5 },
    },
  });
  if (!search) return res.status(404).json({ error: "search not found" });
  return res.json(search);
});
