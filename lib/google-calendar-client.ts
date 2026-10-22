"use client";

import type { Session } from "@supabase/supabase-js";
import { supabase } from "@/lib/db/supabase";

/**
 * Browser side of "connect Google Calendar".
 *
 * Regular sign-in is untouched. This is a separate, explicit consent that asks Google for the
 * narrow `calendar.app.created` scope plus offline access, and it hands the resulting refresh
 * token to our server once. Nothing from Google is kept in the browser afterwards.
 */

export const GOOGLE_CALENDAR_SCOPE = "https://www.googleapis.com/auth/calendar.app.created";
const FLAG = "tornow_connecting_gcal";
const FLAG_MAX_AGE_MS = 10 * 60 * 1000;

/** True while the owner is away at Google granting calendar access (or just came back). */
export function isConnectingCalendar(): boolean {
  try {
    const since = Number(sessionStorage.getItem(FLAG));
    return Number.isFinite(since) && since > 0 && Date.now() - since < FLAG_MAX_AGE_MS;
  } catch {
    return false;
  }
}

export function clearConnectingFlag(): void {
  try {
    sessionStorage.removeItem(FLAG);
  } catch {
    // ignore
  }
}

export type ConnectStart = { ok: true } | { ok: false; error: string };

export async function startGoogleCalendarConnect(): Promise<ConnectStart> {
  if (!supabase) return { ok: false, error: "החיבור ל-Google אינו זמין כרגע." };
  try {
    sessionStorage.setItem(FLAG, String(Date.now()));
  } catch {
    // private mode: the flag only protects the sign-in listener, the flow still works
  }
  const { error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: {
      redirectTo: `${window.location.origin}/admin?gcal=connect`,
      scopes: GOOGLE_CALENDAR_SCOPE,
      queryParams: { access_type: "offline", prompt: "consent" },
    },
  });
  if (error) {
    clearConnectingFlag();
    return { ok: false, error: "לא הצלחנו לפתוח את חיבור Google. נסו שוב." };
  }
  return { ok: true };
}

export interface CalendarStatusDto {
  configured: boolean;
  connected: boolean;
  needsReconnect: boolean;
  email: string | null;
  failedCount: number;
  pendingCount: number;
}

export type ConnectFinish = { ok: true; status: CalendarStatusDto } | { ok: false; error: string };

async function waitForSession(timeoutMs: number): Promise<Session | null> {
  if (!supabase) return null;
  const first = await supabase.auth.getSession();
  if (first.data.session) return first.data.session;
  return new Promise<Session | null>((resolve) => {
    const timer = setTimeout(() => {
      sub.subscription.unsubscribe();
      resolve(null);
    }, timeoutMs);
    const { data: sub } = supabase!.auth.onAuthStateChange((_event, session) => {
      if (!session) return;
      clearTimeout(timer);
      sub.subscription.unsubscribe();
      resolve(session);
    });
  });
}

/**
 * Runs once Google redirected back: reads the one-time provider refresh token, sends it to the
 * server over HTTPS, then drops the temporary Google session from this browser.
 */
export async function finishGoogleCalendarConnect(): Promise<ConnectFinish> {
  try {
    const session = await waitForSession(5000);
    if (!session) {
      return { ok: false, error: "החיבור ל-Google בוטל או לא הושלם. אפשר לנסות שוב." };
    }
    const res = await fetch("/api/google-calendar/connect", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        access_token: session.access_token,
        provider_refresh_token: session.provider_refresh_token ?? null,
      }),
    });
    const data = (await res.json().catch(() => ({}))) as Partial<CalendarStatusDto> & { error?: string };
    if (!res.ok) return { ok: false, error: data.error || "לא הצלחנו להשלים את החיבור ליומן Google." };
    return { ok: true, status: data as CalendarStatusDto };
  } catch {
    return { ok: false, error: "שגיאת תקשורת. נסו שוב." };
  } finally {
    // the temporary Google login must not linger (it would also confuse the regular sign-in)
    try {
      await supabase?.auth.signOut({ scope: "local" });
    } catch {
      // ignore
    }
    clearConnectingFlag();
  }
}
