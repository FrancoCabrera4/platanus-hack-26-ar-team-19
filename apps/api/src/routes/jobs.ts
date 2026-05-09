import { Router, type Router as RouterType } from "express";
import prisma from "@repo/db";
import { requireAuth, requireVerifiedEmail, type AuthUser } from "../auth";

export const jobsRouter: RouterType = Router();

jobsRouter.use(requireAuth, requireVerifiedEmail);

jobsRouter.get("/:id", async (req, res) => {
  const user = res.locals.user as AuthUser;
  const job = await prisma.job.findUnique({
    where: { id: req.params.id },
    include: { search: true },
  });
  if (!job) return res.status(404).json({ error: "job not found" });
  if (job.search?.buyerId !== user.id) return res.status(403).json({ error: "not_the_owner" });
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
