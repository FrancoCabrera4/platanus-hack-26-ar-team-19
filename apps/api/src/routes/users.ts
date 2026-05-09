import { Router, type Router as RouterType } from "express";
import { z } from "zod";
import prisma from "@repo/db";

export const usersRouter: RouterType = Router();

const CreateUser = z.object({
  name: z.string().min(1),
  email: z.string().email(),
  role: z.enum(["seller", "buyer", "both"]),
});

usersRouter.post("/", async (req, res) => {
  const parsed = CreateUser.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }
  const existing = await prisma.user.findUnique({ where: { email: parsed.data.email } });
  if (existing) {
    return res.status(200).json(existing);
  }
  const user = await prisma.user.create({ data: parsed.data });
  return res.status(201).json(user);
});

usersRouter.get("/:id", async (req, res) => {
  const user = await prisma.user.findUnique({ where: { id: req.params.id } });
  if (!user) return res.status(404).json({ error: "user not found" });
  return res.json(user);
});
