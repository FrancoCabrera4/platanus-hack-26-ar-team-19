import { pbkdf2Sync, randomBytes, timingSafeEqual, createHash } from "crypto";
import type { NextFunction, Request, Response } from "express";
import prisma from "@repo/db";

const SESSION_COOKIE = "am_session";
const SESSION_DAYS = 7;
const EMAIL_TOKEN_HOURS = 24;
const RESET_TOKEN_MINUTES = 30;

export type AuthUser = {
  id: string;
  name: string;
  email: string;
  role: string;
  emailVerifiedAt: Date | null;
};

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function makeToken(): string {
  return randomBytes(32).toString("base64url");
}

function addTime(ms: number): Date {
  return new Date(Date.now() + ms);
}

export function publicUser(user: AuthUser) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    emailVerified: Boolean(user.emailVerifiedAt),
    emailVerifiedAt: user.emailVerifiedAt,
  };
}

export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("base64url");
  const hash = pbkdf2Sync(password, salt, 120_000, 32, "sha256").toString("base64url");
  return `pbkdf2_sha256$120000$${salt}$${hash}`;
}

export function verifyPassword(password: string, stored: string | null | undefined): boolean {
  if (!stored) return false;
  const [algorithm, iterationsRaw, salt, hash] = stored.split("$");
  if (algorithm !== "pbkdf2_sha256" || !iterationsRaw || !salt || !hash) return false;

  const calculated = pbkdf2Sync(
    password,
    salt,
    Number(iterationsRaw),
    32,
    "sha256",
  ).toString("base64url");
  const expected = Buffer.from(hash);
  const actual = Buffer.from(calculated);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

function parseCookies(header: string | undefined): Record<string, string> {
  if (!header) return {};
  return Object.fromEntries(
    header.split(";").map((part) => {
      const [key, ...value] = part.trim().split("=");
      return [key, decodeURIComponent(value.join("="))];
    }).filter(([key]) => key),
  );
}

function setSessionCookie(res: Response, token: string) {
  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: SESSION_DAYS * 24 * 60 * 60 * 1000,
    path: "/",
  });
}

export function clearSessionCookie(res: Response) {
  res.clearCookie(SESSION_COOKIE, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
  });
}

export async function createSession(res: Response, userId: string): Promise<void> {
  const token = makeToken();
  await prisma.session.create({
    data: {
      userId,
      tokenHash: hashToken(token),
      expiresAt: addTime(SESSION_DAYS * 24 * 60 * 60 * 1000),
    },
  });
  setSessionCookie(res, token);
}

export async function revokeCurrentSession(req: Request): Promise<void> {
  const token = parseCookies(req.headers.cookie)[SESSION_COOKIE];
  if (!token) return;
  await prisma.session.deleteMany({ where: { tokenHash: hashToken(token) } });
}

export async function getAuthUser(req: Request): Promise<AuthUser | null> {
  const token = parseCookies(req.headers.cookie)[SESSION_COOKIE];
  if (!token) return null;

  const session = await prisma.session.findUnique({
    where: { tokenHash: hashToken(token) },
    include: { user: true },
  });
  if (!session || session.expiresAt <= new Date()) {
    if (session) await prisma.session.delete({ where: { id: session.id } });
    return null;
  }

  return session.user;
}

export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  const user = await getAuthUser(req);
  if (!user) return res.status(401).json({ error: "unauthorized" });
  res.locals.user = user;
  return next();
}

export async function requireVerifiedEmail(req: Request, res: Response, next: NextFunction) {
  const user = (res.locals.user as AuthUser | undefined) ?? await getAuthUser(req);
  if (!user) return res.status(401).json({ error: "unauthorized" });
  if (!user.emailVerifiedAt) {
    return res.status(403).json({ error: "email_not_verified" });
  }
  res.locals.user = user;
  return next();
}

export async function createEmailVerificationToken(userId: string): Promise<string> {
  const token = makeToken();
  await prisma.emailVerificationToken.create({
    data: {
      userId,
      tokenHash: hashToken(token),
      expiresAt: addTime(EMAIL_TOKEN_HOURS * 60 * 60 * 1000),
    },
  });
  return token;
}

export async function consumeEmailVerificationToken(token: string): Promise<AuthUser | null> {
  const record = await prisma.emailVerificationToken.findUnique({
    where: { tokenHash: hashToken(token) },
  });
  if (!record || record.usedAt || record.expiresAt <= new Date()) return null;

  const user = await prisma.user.update({
    where: { id: record.userId },
    data: { emailVerifiedAt: new Date() },
  });
  await prisma.emailVerificationToken.update({
    where: { id: record.id },
    data: { usedAt: new Date() },
  });
  return user;
}

export async function createPasswordResetToken(userId: string): Promise<string> {
  const token = makeToken();
  await prisma.passwordResetToken.create({
    data: {
      userId,
      tokenHash: hashToken(token),
      expiresAt: addTime(RESET_TOKEN_MINUTES * 60 * 1000),
    },
  });
  return token;
}

export async function consumePasswordResetToken(
  token: string,
  password: string,
): Promise<AuthUser | null> {
  const record = await prisma.passwordResetToken.findUnique({
    where: { tokenHash: hashToken(token) },
  });
  if (!record || record.usedAt || record.expiresAt <= new Date()) return null;

  const user = await prisma.user.update({
    where: { id: record.userId },
    data: { passwordHash: hashPassword(password) },
  });
  await prisma.passwordResetToken.update({
    where: { id: record.id },
    data: { usedAt: new Date() },
  });
  await prisma.session.deleteMany({ where: { userId: user.id } });
  return user;
}

export function devLink(path: string, token: string): string {
  const origin = process.env.WEB_ORIGIN ?? "http://localhost:3000";
  return `${origin}${path}?token=${encodeURIComponent(token)}`;
}
