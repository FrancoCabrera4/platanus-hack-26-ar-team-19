import { Router, type Router as RouterType } from "express";
import { z } from "zod";
import prisma from "@repo/db";
import { log } from "@repo/logger";
import {
  clearSessionCookie,
  consumeEmailVerificationToken,
  consumePasswordResetToken,
  createEmailVerificationToken,
  createPasswordResetToken,
  createSession,
  devLink,
  getAuthUser,
  hashPassword,
  publicUser,
  requireAuth,
  revokeCurrentSession,
  verifyPassword,
} from "../auth";
import { asyncHandler } from "./_sse";

export const authRouter: RouterType = Router();

const SignupBody = z.object({
  name: z.string().min(1),
  email: z.string().email(),
  password: z.string().min(8),
  role: z.enum(["seller", "buyer", "both"]),
});

const LoginBody = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

const TokenBody = z.object({ token: z.string().min(1) });

const ResetRequestBody = z.object({
  email: z.string().email(),
});

const ResetBody = z.object({
  token: z.string().min(1),
  password: z.string().min(8),
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
          role: parsed.data.role,
          passwordHash: hashPassword(parsed.data.password),
        },
      })
    : await prisma.user.create({
        data: {
          name: parsed.data.name,
          email: parsed.data.email,
          role: parsed.data.role,
          passwordHash: hashPassword(parsed.data.password),
        },
      });

  await createSession(res, user.id);
  const token = await createEmailVerificationToken(user.id);
  const verificationUrl = devLink("/verify-email", token);
  log(`DEV email verification for ${user.email}: ${verificationUrl}`);

  return res.status(201).json({
    user: publicUser(user),
    verificationUrl,
    verificationToken: token,
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

authRouter.post("/request-email-verification", requireAuth, asyncHandler(async (_req, res) => {
  const user = res.locals.user;
  if (user.emailVerifiedAt) return res.json({ user: publicUser(user) });

  const token = await createEmailVerificationToken(user.id);
  const verificationUrl = devLink("/verify-email", token);
  log(`DEV email verification for ${user.email}: ${verificationUrl}`);
  return res.json({ verificationUrl, verificationToken: token });
}));

authRouter.post("/verify-email", asyncHandler(async (req, res) => {
  const parsed = TokenBody.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const user = await consumeEmailVerificationToken(parsed.data.token);
  if (!user) return res.status(400).json({ error: "invalid_or_expired_token" });
  return res.json({ user: publicUser(user) });
}));

authRouter.post("/request-password-reset", asyncHandler(async (req, res) => {
  const parsed = ResetRequestBody.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const user = await prisma.user.findUnique({ where: { email: parsed.data.email } });
  if (user?.passwordHash) {
    const token = await createPasswordResetToken(user.id);
    const resetUrl = devLink("/reset-password", token);
    log(`DEV password reset for ${user.email}: ${resetUrl}`);
    return res.json({ ok: true, resetUrl, resetToken: token });
  }

  return res.json({ ok: true });
}));

authRouter.post("/reset-password", asyncHandler(async (req, res) => {
  const parsed = ResetBody.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const user = await consumePasswordResetToken(parsed.data.token, parsed.data.password);
  if (!user) return res.status(400).json({ error: "invalid_or_expired_token" });
  clearSessionCookie(res);
  return res.json({ user: publicUser(user) });
}));
