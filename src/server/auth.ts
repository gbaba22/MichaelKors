/**
 * Admin access: a single shared password (ADMIN_PASSWORD) exchanged for an
 * HMAC-signed, HttpOnly session cookie. No user accounts to manage, which is
 * the right trade-off for an internal tool with one admin role.
 */
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';

const COOKIE_NAME = 'aica_admin';
const SESSION_TTL_MS = 12 * 60 * 60 * 1000; // 12 hours

// Without a configured secret, sessions simply don't survive a restart.
const secret = process.env.SESSION_SECRET || randomBytes(32).toString('hex');

export function adminPassword(): string | undefined {
  const value = process.env.ADMIN_PASSWORD;
  return value && value.length > 0 ? value : undefined;
}

function sign(payload: string): string {
  return createHmac('sha256', secret).update(payload).digest('base64url');
}

/** Compares without leaking length or position through timing. */
function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

export function checkPassword(candidate: string): boolean {
  const expected = adminPassword();
  if (!expected) return false;
  return safeEqual(candidate, expected);
}

function createToken(): string {
  const expiresAt = Date.now() + SESSION_TTL_MS;
  const payload = `admin.${expiresAt}`;
  return `${payload}.${sign(payload)}`;
}

function verifyToken(token: string | undefined): boolean {
  if (!token) return false;
  const parts = token.split('.');
  if (parts.length !== 3) return false;
  const [role, expiresAt, signature] = parts;
  if (role !== 'admin') return false;
  if (!safeEqual(signature, sign(`${role}.${expiresAt}`))) return false;
  return Number(expiresAt) > Date.now();
}

/** Minimal cookie parsing; the app sets exactly one cookie. */
function readCookie(req: Request, name: string): string | undefined {
  const header = req.headers.cookie;
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const [key, ...rest] = part.trim().split('=');
    if (key === name) return decodeURIComponent(rest.join('='));
  }
  return undefined;
}

export function startSession(res: Response) {
  res.cookie(COOKIE_NAME, createToken(), {
    httpOnly: true,
    sameSite: 'lax',
    maxAge: SESSION_TTL_MS,
    // Only over HTTPS when the app is actually served over HTTPS.
    secure: process.env.COOKIE_SECURE === 'true',
    path: '/',
  });
}

export function endSession(res: Response) {
  res.clearCookie(COOKIE_NAME, { path: '/' });
}

export function isAdmin(req: Request): boolean {
  return verifyToken(readCookie(req, COOKIE_NAME));
}

/** Gate for every /api/admin route. */
export function requireAdmin(req: Request, res: Response, next: NextFunction) {
  if (!isAdmin(req)) {
    res.status(401).json({ error: 'Not signed in' });
    return;
  }
  next();
}
