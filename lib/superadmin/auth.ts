import crypto from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { signForDomain } from "@/lib/auth";
import { SUPERADMIN_COOKIE, SUPERADMIN_SIGN_DOMAIN, SUPERADMIN_TTL_SECONDS, JSON_NO_STORE } from "@/lib/superadmin/config";

/**
 * Who may open /superadmin: the e-mail addresses in SUPERADMIN_EMAILS (comma separated). Empty or missing
 * means NOBODY (fail closed). No address is written in the code.
 */
export function parseAllowlist(raw: string | undefined | null): string[] {
  if (!raw) return [];
  const emails = raw
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  return [...new Set(emails)];
}

/** Exact match (lower-cased, trimmed) against the allowlist. */
export function isAllowedEmail(email: unknown, rawAllowlist: string | undefined | null = process.env.SUPERADMIN_EMAILS): boolean {
  if (typeof email !== "string") return false;
  const e = email.trim().toLowerCase();
  if (!e) return false;
  return parseAllowlist(rawAllowlist).includes(e);
}

// -------------------------------------------------------------------- the cookie

interface Payload {
  v: 1;
  em: string;
  exp: number; // unix seconds
}

const sig = (payload: string) => signForDomain(SUPERADMIN_SIGN_DOMAIN, payload);

function sameSignature(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

/** The value of the cookie: the e-mail and the expiry, signed with the superadmin domain. */
export function createSuperadminToken(email: string, nowMs: number = Date.now()): string {
  const payload: Payload = { v: 1, em: email.trim().toLowerCase(), exp: Math.floor(nowMs / 1000) + SUPERADMIN_TTL_SECONDS };
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${encoded}.${sig(encoded)}`;
}

/**
 * The e-mail of a valid cookie, else null. Valid = our signature (superadmin domain), not expired, and the
 * e-mail is STILL on the allowlist right now: taking someone off the list locks their session out at once.
 */
export function verifySuperadminToken(
  token: string | undefined | null,
  nowMs: number = Date.now(),
  rawAllowlist: string | undefined | null = process.env.SUPERADMIN_EMAILS
): { email: string; exp: number } | null {
  if (!token) return null;
  const parts = token.split(".");
  if (parts.length !== 2 || !parts[0] || !parts[1]) return null;
  try {
    if (!sameSignature(parts[1], sig(parts[0]))) return null;
    const p = JSON.parse(Buffer.from(parts[0], "base64url").toString("utf8")) as Partial<Payload>;
    if (p.v !== 1 || typeof p.em !== "string" || typeof p.exp !== "number") return null;
    if (p.exp * 1000 <= nowMs) return null;
    if (!isAllowedEmail(p.em, rawAllowlist)) return null;
    return { email: p.em.toLowerCase(), exp: p.exp };
  } catch {
    return null;
  }
}

export function getSuperadmin(request: NextRequest): { email: string } | null {
  const v = verifySuperadminToken(request.cookies.get(SUPERADMIN_COOKIE)?.value);
  return v ? { email: v.email } : null;
}

export function unauthorizedJson() {
  return NextResponse.json({ error: "unauthorized" }, { status: 401, headers: JSON_NO_STORE });
}

/** For the API routes: the signed-in superadmin, or a ready 401. */
export function requireSuperadmin(
  request: NextRequest
): { admin: { email: string }; error?: undefined } | { admin?: undefined; error: NextResponse } {
  const admin = getSuperadmin(request);
  return admin ? { admin } : { error: unauthorizedJson() };
}

export function setSuperadminCookie(res: NextResponse, token: string): void {
  res.cookies.set(SUPERADMIN_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    path: "/",
    maxAge: SUPERADMIN_TTL_SECONDS,
  });
}

export function clearSuperadminCookie(res: NextResponse): void {
  res.cookies.set(SUPERADMIN_COOKIE, "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    path: "/",
    maxAge: 0,
  });
}
