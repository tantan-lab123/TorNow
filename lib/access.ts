import { NextRequest, NextResponse } from "next/server";
import {
  credentialFingerprint,
  forbidden,
  getSession,
  unauthorized,
  type Role,
  type Session,
} from "@/lib/auth";
import { getBusinessById, getStaffById } from "@/lib/db";

// Short cache so a disabled/deleted staff member loses access within seconds without a DB hit per request.
const activeCache = new Map<string, { ok: boolean; until: number }>();

async function staffStillActive(session: Session): Promise<boolean> {
  if (!session.staffId) return true; // owner sessions
  const hit = activeCache.get(session.staffId);
  if (hit && hit.until > Date.now()) return hit.ok;
  const s = await getStaffById(session.staffId);
  const ok = !!s && s.active && s.business_id === session.businessId && s.role === session.role;
  activeCache.set(session.staffId, { ok, until: Date.now() + 15_000 });
  return ok;
}

// Same idea for passwords: a session from before the current password stops working.
const credentialCache = new Map<string, { ok: boolean; until: number }>();

async function credentialsCurrent(session: Session): Promise<boolean> {
  if (!session.pv) return true; // tokens issued before this check, until they expire
  const key = `${session.staffId ?? session.businessId}:${session.pv}`;
  const hit = credentialCache.get(key);
  if (hit && hit.until > Date.now()) return hit.ok;
  const holder = session.staffId
    ? await getStaffById(session.staffId)
    : await getBusinessById(session.businessId);
  const ok = !!holder && credentialFingerprint(holder.password) === session.pv;
  credentialCache.set(key, { ok, until: Date.now() + 15_000 });
  return ok;
}

/** Drop the cached verdict right after staff are changed so it takes effect immediately. */
export function forgetStaffCache(staffId: string) {
  activeCache.delete(staffId);
  forgetCredentialCache(staffId);
}

/** Call after a password changes so this server stops accepting older sessions at once. */
export function forgetCredentialCache(ownerOrStaffId: string) {
  for (const key of credentialCache.keys()) {
    if (key.startsWith(`${ownerOrStaffId}:`)) credentialCache.delete(key);
  }
}

/** The signed-in session, if its staff account is active and its password is still current. */
export async function getValidSession(request: NextRequest): Promise<Session | null> {
  const session = getSession(request);
  if (!session) return null;
  if (!(await staffStillActive(session)) || !(await credentialsCurrent(session))) return null;
  return session;
}

/**
 * Session whose role is one of `roles` (and, for staff, whose account is still active).
 * Otherwise returns a ready-made 401/403 response.
 */
export async function requireRole(
  request: NextRequest,
  roles: Role[]
): Promise<{ session: Session; error?: undefined } | { session?: undefined; error: NextResponse }> {
  const session = getSession(request);
  if (!session) return { error: unauthorized() };
  if (!(await staffStillActive(session))) return { error: unauthorized("החשבון הושבת") };
  if (!(await credentialsCurrent(session))) {
    return { error: unauthorized("הסיסמה שונתה. יש להתחבר מחדש.") };
  }
  if (!roles.includes(session.role)) return { error: forbidden("אין לך הרשאה לפעולה זו") };
  return { session };
}

export const ANY_ROLE: Role[] = ["owner", "manager", "staff"];
export const MANAGEMENT: Role[] = ["owner", "manager"];
export const OWNER_ONLY: Role[] = ["owner"];
