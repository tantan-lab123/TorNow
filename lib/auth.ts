import crypto from "crypto";
import bcrypt from "bcryptjs";
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import type { Business } from "@/lib/types";
import { dropLegacyPrefills } from "@/lib/validation";

export const SESSION_COOKIE = "tornow_session";
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 14; // 14 days

const g = globalThis as unknown as { __TORNOW_DEV_SECRET__?: string };
function getSecret(): string {
  const s = process.env.SESSION_SECRET;
  if (s && s.length >= 32) return s;
  // No dedicated secret: derive one from the server-only service-role key (never exposed to the browser).
  const svc = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (svc && svc.length >= 32) {
    return crypto.createHash("sha256").update("torli-session-v1:" + svc).digest("hex");
  }
  if (process.env.NODE_ENV === "production") {
    throw new Error("SESSION_SECRET (>=32 chars) or SUPABASE_SERVICE_ROLE_KEY must be set in production");
  }
  // dev only: shared across route bundles so sessions survive hot reloads
  g.__TORNOW_DEV_SECRET__ = g.__TORNOW_DEV_SECRET__ || crypto.randomBytes(32).toString("hex");
  return g.__TORNOW_DEV_SECRET__;
}

function sign(data: string): string {
  return crypto.createHmac("sha256", getSecret()).update(data).digest("base64url");
}

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && crypto.timingSafeEqual(ab, bb);
}

// ---------------------------------------------------------------- sessions
export type Role = "owner" | "manager" | "staff";
export interface Session {
  businessId: string;
  role: Role;
  staffId?: string;
  /** Fingerprint of the password hash at login (absent on tokens issued before it existed). */
  pv?: string;
}

/** Short fingerprint of a stored password hash: setting a new password ends every older session. */
export function credentialFingerprint(passwordHash: string | null | undefined): string {
  return sign(`cred:${passwordHash || ""}`).slice(0, 16);
}

export function createSessionToken(
  businessId: string,
  role: Role = "owner",
  staffId?: string,
  passwordHash?: string | null
): string {
  const payload = Buffer.from(
    JSON.stringify({
      bid: businessId,
      role,
      ...(staffId ? { sid: staffId } : {}),
      pv: credentialFingerprint(passwordHash),
      exp: Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS,
    })
  ).toString("base64url");
  return `${payload}.${sign(payload)}`;
}

export function verifySession(token: string | undefined): Session | null {
  if (!token) return null;
  const [payload, sig] = token.split(".");
  if (!payload || !sig || !safeEqual(sig, sign(payload))) return null;
  try {
    const { bid, exp, role, sid, pv } = JSON.parse(Buffer.from(payload, "base64url").toString());
    if (typeof bid !== "string" || typeof exp !== "number") return null;
    if (exp < Math.floor(Date.now() / 1000)) return null;
    // tokens issued before roles existed were owner logins
    const r: Role = role === "manager" || role === "staff" ? role : "owner";
    return {
      businessId: bid,
      role: r,
      ...(typeof sid === "string" ? { staffId: sid } : {}),
      ...(typeof pv === "string" ? { pv } : {}),
    };
  } catch {
    return null;
  }
}

export function verifySessionToken(token: string | undefined): string | null {
  return verifySession(token)?.businessId ?? null;
}

export function getSession(request: NextRequest): Session | null {
  return verifySession(request.cookies.get(SESSION_COOKIE)?.value);
}

/** `passwordHash` is the stored hash of whoever logs in (business or staff member), null if none. */
export function setSessionCookie(
  res: NextResponse,
  businessId: string,
  role: Role,
  staffId: string | undefined,
  passwordHash: string | null | undefined
): void {
  res.cookies.set(SESSION_COOKIE, createSessionToken(businessId, role, staffId, passwordHash), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_TTL_SECONDS,
  });
}

export function clearSessionCookie(res: NextResponse): void {
  res.cookies.set(SESSION_COOKIE, "", { httpOnly: true, path: "/", maxAge: 0 });
}

export function unauthorized(message = "נדרשת התחברות") {
  return NextResponse.json({ error: message }, { status: 401 });
}
export function forbidden(message = "אין הרשאה לפעולה זו") {
  return NextResponse.json({ error: message }, { status: 403 });
}

// --------------------------------------------------------------- passwords
const BCRYPT_RE = /^\$2[aby]\$/;

export function hashPassword(plain: string): string {
  return bcrypt.hashSync(plain, 11);
}

/** Verifies a password. Tolerates legacy plaintext rows (flagged via needsRehash). */
export function verifyPassword(
  plain: string,
  stored: string | null | undefined
): { ok: boolean; needsRehash: boolean } {
  if (!stored) return { ok: false, needsRehash: false };
  if (BCRYPT_RE.test(stored)) {
    return { ok: bcrypt.compareSync(plain, stored), needsRehash: false };
  }
  return { ok: safeEqual(plain, stored), needsRehash: true };
}

// ------------------------------------------------------------ calendar feed
// The owner's feed link belongs to the business. Each manager gets a link of their own, which
// stops working once they are deactivated, removed or no longer a manager. Raising the
// business's calendar_version (the owner's "new link" button) replaces every link at once.
export function calendarToken(businessId: string, version = 0, staffId?: string): string {
  const parts = [`calendar:${businessId}`];
  if (version) parts.push(`v${version}`);
  if (staffId) parts.push(`staff:${staffId}`);
  return crypto.createHmac("sha256", getSecret()).update(parts.join(":")).digest("hex").slice(0, 40);
}
export function verifyCalendarToken(
  token: string | null,
  businessId: string,
  version = 0,
  staffId?: string
): boolean {
  return !!token && safeEqual(token, calendarToken(businessId, version, staffId));
}

// ----------------------------------------------------- cron / shared secret
export function verifyBearer(request: NextRequest, secret: string | undefined): boolean {
  if (!secret || secret.length < 16) return false;
  const header = request.headers.get("authorization") || "";
  return safeEqual(header, `Bearer ${secret}`);
}

// ------------------------------------------------------ Google (via Supabase)
/** Verifies a Supabase Auth access token (Google or email-link) and returns the verified identity. */
export async function verifySupabaseToken(
  accessToken: unknown,
  provider: "google" | "email"
): Promise<{ email: string; id: string } | null> {
  if (typeof accessToken !== "string" || accessToken.length < 20) return null;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.replace(/\/rest\/v1\/?$/, "").replace(/\/+$/, "");
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anon) return null;
  const client = createClient(url, anon, { auth: { persistSession: false } });
  const { data, error } = await client.auth.getUser(accessToken);
  const user = data?.user;
  if (error || !user?.email || !user.email_confirmed_at) return null;
  if (user.app_metadata?.provider !== provider) return null;
  return { email: user.email.toLowerCase(), id: user.id };
}

export function verifyGoogleAccessToken(accessToken: unknown) {
  return verifySupabaseToken(accessToken, "google");
}

// -------------------------------------------------------------- sanitizers
/** Fields safe to show to anyone (public booking page). */
export function toPublicBusiness(b: Business): Business {
  const { password, pin, google_id, owner_email, calendar_token, calendar_version, ...rest } = b;
  // the share-picture is a large inline image that only /api/og needs: keep it out of the public JSON
  const publicSettings = dropLegacyPrefills(rest.settings);
  if (publicSettings) {
    delete publicSettings.og_image_url;
    // the SMS switch and wording are the owner's business, not the booking page's
    delete publicSettings.sms_confirmation_enabled;
    delete publicSettings.sms_confirmation_template;
  }
  return { ...rest, settings: publicSettings } as Business;
}

/** Fields for the logged-in owner: never the password hash / pin / google id. */
export function toOwnerBusiness(b: Business, role: Role = "owner", staffId?: string): Business {
  const { password, pin, google_id, calendar_version, ...rest } = b;
  const clean = { ...rest, settings: dropLegacyPrefills(rest.settings) };
  // the calendar-feed secret is only for the owner and managers, each manager with their own
  const token =
    role === "owner"
      ? calendarToken(b.id, calendar_version)
      : role === "manager" && staffId
        ? calendarToken(b.id, calendar_version, staffId)
        : undefined;
  return (token ? { ...clean, calendar_token: token } : clean) as Business;
}
