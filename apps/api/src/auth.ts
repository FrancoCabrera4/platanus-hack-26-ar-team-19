import { pbkdf2Sync, randomBytes, timingSafeEqual, createHash } from "crypto";
import type { NextFunction, Request, Response } from "express";
import prisma from "@repo/db";

const SESSION_COOKIE = "am_session";
const SESSION_DAYS = 7;

export type AuthUser = {
  id: string;
  name: string;
  email: string;
  mpConnected?: boolean;
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
    mpConnected: user.mpConnected ?? false,
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
