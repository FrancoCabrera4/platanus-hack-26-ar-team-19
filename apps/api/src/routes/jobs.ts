import { Router, type Router as RouterType } from "express";
import prisma from "@repo/db";

export const jobsRouter: RouterType = Router();

jobsRouter.get("/:id", async (req, res) => {
  const job = await prisma.job.findUnique({ where: { id: req.params.id } });
  if (!job) return res.status(404).json({ error: "job not found" });
  return res.json({
    id: job.id,
    type: job.type,
    status: job.status,
    searchId: job.searchId,
    error: job.error,
    result: job.result ? JSON.parse(job.result) : null,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
  });
});
