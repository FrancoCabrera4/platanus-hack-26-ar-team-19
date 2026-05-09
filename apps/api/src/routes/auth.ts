import { Router, type Router as RouterType } from "express";
import { z } from "zod";
import prisma from "@repo/db";
import {
  clearSessionCookie,
  createSession,
  getAuthUser,
  hashPassword,
  publicUser,
  revokeCurrentSession,
  verifyPassword,
} from "../auth";
import { asyncHandler } from "./_sse";

export const authRouter: RouterType = Router();

const SignupBody = z.object({
  name: z.string().min(1),
  email: z.string().email(),
  password: z.string().min(8),
});

const LoginBody = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

authRouter.post("/signup", asyncHandler(async (req, res) => {
  const parsed = SignupBody.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const existing = await prisma.user.findUnique({ where: { email: parsed.data.email } });
  if (existing?.passwordHash) {
    return res.status(409).json({ error: "email_already_registered" });
  }

  const user = existing
    ? await prisma.user.update({
        where: { id: existing.id },
        data: {
          name: parsed.data.name,
          passwordHash: hashPassword(parsed.data.password),
        },
      })
    : await prisma.user.create({
        data: {
          name: parsed.data.name,
          email: parsed.data.email,
          passwordHash: hashPassword(parsed.data.password),
        },
      });

  await createSession(res, user.id);

  return res.status(201).json({
    user: publicUser(user),
  });
}));

authRouter.post("/login", asyncHandler(async (req, res) => {
  const parsed = LoginBody.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const user = await prisma.user.findUnique({ where: { email: parsed.data.email } });
  if (!user || !verifyPassword(parsed.data.password, user.passwordHash)) {
    return res.status(401).json({ error: "invalid_credentials" });
  }

  await createSession(res, user.id);
  return res.json({ user: publicUser(user) });
}));

authRouter.post("/logout", asyncHandler(async (req, res) => {
  await revokeCurrentSession(req);
  clearSessionCookie(res);
  return res.status(204).end();
}));

authRouter.get("/me", asyncHandler(async (req, res) => {
  const user = await getAuthUser(req);
  if (!user) return res.status(401).json({ error: "unauthorized" });
  return res.json({ user: publicUser(user) });
}));
