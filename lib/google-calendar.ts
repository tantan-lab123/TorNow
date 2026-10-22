import { z } from "zod";
import { decryptToken, encryptToken } from "@/lib/crypto-token";
import { BUSINESS_TZ } from "@/lib/booking/slotGenerator";
import { DEFAULT_CALENDAR_REMINDER_MINUTES } from "@/lib/validation";
import type { Appointment, BusinessSettings, Service } from "@/lib/types";

/**
 * One-way sync: TorNow appointments -> the business owner's Google Calendar.
 *
 * Server-side only. This module never touches the database directly: everything it needs
 * comes through the `SyncRepo` / `ConnectionRepo` interfaces (wired up in lib/google-sync.ts),
 * which keeps it testable. Tokens are never logged or returned.
 */

// -------------------------------------------------------------------------- constants
/** Non-sensitive scope: the app can create its own calendar and manage events only on calendars it created. */
export const GOOGLE_CALENDAR_SCOPE = "https://www.googleapis.com/auth/calendar.app.created";
export const DEDICATED_CALENDAR_NAME = "TorNow – תורים";
/** Minutes to wait after the 1st..5th failed attempt. A 6th failure gives up (initial try + 5 retries). */
export const BACKOFF_MINUTES = [1, 5, 15, 60, 240] as const;
export const MAX_RETRIES = BACKOFF_MINUTES.length;
const ACCESS_TOKEN_SAFETY_MS = 60_000;
/** A run that never finished is picked up again after this long. */
const STUCK_GUARD_MINUTES = 2;

// -------------------------------------------------------------------------- errors
export class GoogleNotConfiguredError extends Error {
  constructor() {
    super("GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET are not set");
    this.name = "GoogleNotConfiguredError";
  }
}
/** The refresh token was revoked or expired: the owner must connect again. */
export class GoogleAuthRevokedError extends Error {
  constructor() {
    super("google_auth_revoked");
    this.name = "GoogleAuthRevokedError";
  }
}
/** The dedicated calendar no longer exists (the owner deleted it in Google). */
export class GoogleCalendarMissingError extends Error {
  constructor() {
    super("calendar_not_found");
    this.name = "GoogleCalendarMissingError";
  }
}
export class GoogleApiError extends Error {
  constructor(
    readonly status: number,
    readonly reason: string,
    readonly retryable: boolean
  ) {
    super(`google_api_${status}_${reason}`);
    this.name = "GoogleApiError";
  }
}

// -------------------------------------------------------------------------- configuration
interface Endpoints {
  api: string;
  token: string;
  revoke: string;
}
/** Base URLs can be pointed at a local fake Google, but never in production. */
function endpoints(): Endpoints {
  const dev = process.env.NODE_ENV !== "production";
  return {
    api: (dev && process.env.GOOGLE_API_BASE) || "https://www.googleapis.com",
    token: (dev && process.env.GOOGLE_TOKEN_URL) || "https://oauth2.googleapis.com/token",
    revoke: (dev && process.env.GOOGLE_REVOKE_URL) || "https://oauth2.googleapis.com/revoke",
  };
}

function credentials(): { clientId: string; clientSecret: string } {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) throw new GoogleNotConfiguredError();
  return { clientId, clientSecret };
}

export function isGoogleCalendarConfigured(): boolean {
  return Boolean(
    process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET && process.env.GOOGLE_TOKEN_ENCRYPTION_KEY
  );
}

// -------------------------------------------------------------------------- HTTP helpers
const errorBody = z.object({
  error: z
    .union([
      z.string(),
      z.object({
        status: z.string().optional(),
        errors: z.array(z.object({ reason: z.string().optional() })).optional(),
      }),
    ])
    .optional(),
});

async function readJson(res: Response): Promise<unknown> {
  try {
    return await res.json();
  } catch {
    return null;
  }
}

/** Builds an error from a failed Google response using only its short machine-readable reason. */
function apiError(status: number, body: unknown): GoogleApiError {
  const parsed = errorBody.safeParse(body);
  let reason = "unknown";
  if (parsed.success && parsed.data.error) {
    const e = parsed.data.error;
    reason = typeof e === "string" ? e : e.errors?.[0]?.reason ?? e.status ?? "unknown";
  }
  const retryable = status === 429 || status >= 500 || (status === 403 && /ratelimit|quota/i.test(reason));
  return new GoogleApiError(status, reason, retryable);
}

async function authorizedFetch(accessToken: string, url: string, init: RequestInit = {}): Promise<Response> {
  try {
    return await fetch(url, {
      ...init,
      headers: {
        ...(init.headers as Record<string, string> | undefined),
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
    });
  } catch {
    // network failure / timeout: worth retrying
    throw new GoogleApiError(0, "network", true);
  }
}

// -------------------------------------------------------------------------- access tokens
const tokenResponse = z.object({ access_token: z.string().min(1), expires_in: z.number().positive() });

/** Exchanges a refresh token for a short-lived access token. */
export async function refreshAccessToken(refreshToken: string): Promise<{ accessToken: string; expiresInSec: number }> {
  const { clientId, clientSecret } = credentials();
  let res: Response;
  try {
    res = await fetch(endpoints().token, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: refreshToken,
        grant_type: "refresh_token",
      }),
    });
  } catch {
    throw new GoogleApiError(0, "network", true);
  }
  const body = await readJson(res);
  if (!res.ok) {
    const parsed = errorBody.safeParse(body);
    const code = parsed.success && typeof parsed.data.error === "string" ? parsed.data.error : "token_error";
    if (code === "invalid_grant") throw new GoogleAuthRevokedError();
    throw new GoogleApiError(res.status, code, res.status === 429 || res.status >= 500);
  }
  const ok = tokenResponse.safeParse(body);
  if (!ok.success) throw new GoogleApiError(502, "bad_token_response", true);
  return { accessToken: ok.data.access_token, expiresInSec: ok.data.expires_in };
}

const accessTokenCache = new Map<string, { token: string; expiresAt: number }>();

export function clearAccessTokenCache(businessId?: string): void {
  if (businessId) accessTokenCache.delete(businessId);
  else accessTokenCache.clear();
}

/** Cached per business, for the (short) lifetime of the token. */
export async function getAccessToken(businessId: string, refreshToken: string, now = Date.now()): Promise<string> {
  const hit = accessTokenCache.get(businessId);
  if (hit && hit.expiresAt > now) return hit.token;
  const { accessToken, expiresInSec } = await refreshAccessToken(refreshToken);
  accessTokenCache.set(businessId, { token: accessToken, expiresAt: now + expiresInSec * 1000 - ACCESS_TOKEN_SAFETY_MS });
  return accessToken;
}

// -------------------------------------------------------------------------- events
export interface SyncContext {
  appointment: Appointment;
  service?: Pick<Service, "name"> | null;
  client?: { first_name: string; last_name: string; phone: string; email?: string | null } | null;
  business: { id: string; name: string; settings?: BusinessSettings };
}

interface GoogleEventBody {
  summary: string;
  description: string;
  start: { dateTime: string; timeZone: string };
  end: { dateTime: string; timeZone: string };
  status: "confirmed";
  reminders: { useDefault: false; overrides: { method: "popup"; minutes: number }[] };
  extendedProperties: { private: { tornowAppointmentId: string } };
}

/** The deterministic Google event id: the appointment UUID without dashes (valid base32hex, 32 chars). */
export function eventIdForAppointment(appointmentId: string): string {
  return appointmentId.replace(/-/g, "").toLowerCase();
}

function clip(value: string, max: number): string {
  return value.length > max ? value.slice(0, max - 1) + "…" : value;
}

export function buildEventBody(ctx: SyncContext, appUrl: string): GoogleEventBody {
  const { appointment, service, client, business } = ctx;
  const serviceName = service?.name?.trim() || "תור";
  const customerName = client ? `${client.first_name} ${client.last_name}`.trim() : "לקוח";
  const reminderMinutes = business.settings?.calendar_reminder_minutes ?? DEFAULT_CALENDAR_REMINDER_MINUTES;

  const lines = [
    `לקוח: ${customerName}`,
    client?.phone ? `טלפון: ${client.phone}` : null,
    client?.email ? `אימייל: ${client.email}` : null,
    `שירות: ${serviceName}`,
    appointment.notes ? `הערות: ${appointment.notes}` : null,
    `לניהול התור: ${appUrl.replace(/\/+$/, "")}/admin`,
  ].filter((l): l is string => l !== null);

  return {
    summary: clip(`${serviceName} - ${customerName}`, 1000),
    description: clip(lines.join("\n"), 8000),
    start: { dateTime: new Date(appointment.start_time).toISOString(), timeZone: BUSINESS_TZ },
    end: { dateTime: new Date(appointment.end_time).toISOString(), timeZone: BUSINESS_TZ },
    status: "confirmed",
    reminders: {
      useDefault: false,
      overrides: reminderMinutes > 0 ? [{ method: "popup", minutes: reminderMinutes }] : [],
    },
    extendedProperties: { private: { tornowAppointmentId: appointment.id } },
  };
}

const eventResponse = z.object({ id: z.string().min(1) });

function eventsUrl(calendarId: string, eventId?: string): string {
  const base = `${endpoints().api}/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`;
  return eventId ? `${base}/${encodeURIComponent(eventId)}?sendUpdates=none` : `${base}?sendUpdates=none`;
}

async function insertEvent(
  accessToken: string,
  calendarId: string,
  eventId: string,
  body: GoogleEventBody
): Promise<string> {
  const res = await authorizedFetch(accessToken, eventsUrl(calendarId), {
    method: "POST",
    body: JSON.stringify({ id: eventId, ...body }),
  });
  if (res.status === 409) {
    // Already exists (a retry, or an event that was cancelled earlier): bring it up to date and restore it.
    return patchEvent(accessToken, calendarId, eventId, body);
  }
  if (res.status === 404) throw new GoogleCalendarMissingError();
  const json = await readJson(res);
  if (!res.ok) throw apiError(res.status, json);
  const parsed = eventResponse.safeParse(json);
  return parsed.success ? parsed.data.id : eventId;
}

async function patchEvent(
  accessToken: string,
  calendarId: string,
  eventId: string,
  body: GoogleEventBody
): Promise<string> {
  const res = await authorizedFetch(accessToken, eventsUrl(calendarId, eventId), {
    method: "PATCH",
    body: JSON.stringify(body),
  });
  const json = await readJson(res);
  if (!res.ok) throw apiError(res.status, json);
  const parsed = eventResponse.safeParse(json);
  return parsed.success ? parsed.data.id : eventId;
}

/**
 * Creates the event, or updates it. Idempotent: the event id is derived from the appointment,
 * so a repeated call can never produce a duplicate.
 */
export async function upsertEvent(
  accessToken: string,
  calendarId: string,
  appointmentId: string,
  knownEventId: string | null | undefined,
  body: GoogleEventBody
): Promise<string> {
  const eventId = knownEventId || eventIdForAppointment(appointmentId);
  if (knownEventId) {
    try {
      return await patchEvent(accessToken, calendarId, knownEventId, body);
    } catch (err) {
      // the owner deleted it by hand: create it again
      if (!(err instanceof GoogleApiError && err.status === 404)) throw err;
      return insertEvent(accessToken, calendarId, eventIdForAppointment(appointmentId), body);
    }
  }
  return insertEvent(accessToken, calendarId, eventId, body);
}

/** Removes the event. "Already gone" (404) and "deleted earlier" (410) count as success. */
export async function deleteEvent(accessToken: string, calendarId: string, eventId: string): Promise<void> {
  const res = await authorizedFetch(accessToken, eventsUrl(calendarId, eventId), { method: "DELETE" });
  if (res.ok || res.status === 404 || res.status === 410) return;
  throw apiError(res.status, await readJson(res));
}

// -------------------------------------------------------------------------- calendars & token revocation
const calendarResponse = z.object({ id: z.string().min(1) });

/** Creates the dedicated "TorNow" calendar in the owner's account and returns its id. */
export async function createDedicatedCalendar(accessToken: string): Promise<string> {
  const res = await authorizedFetch(accessToken, `${endpoints().api}/calendar/v3/calendars`, {
    method: "POST",
    body: JSON.stringify({ summary: DEDICATED_CALENDAR_NAME, timeZone: BUSINESS_TZ }),
  });
  const json = await readJson(res);
  if (!res.ok) throw apiError(res.status, json);
  const parsed = calendarResponse.safeParse(json);
  if (!parsed.success) throw new GoogleApiError(502, "bad_calendar_response", false);
  return parsed.data.id;
}

export async function deleteCalendar(accessToken: string, calendarId: string): Promise<void> {
  const res = await authorizedFetch(
    accessToken,
    `${endpoints().api}/calendar/v3/calendars/${encodeURIComponent(calendarId)}`,
    { method: "DELETE" }
  );
  if (res.ok || res.status === 404 || res.status === 410) return;
  throw apiError(res.status, await readJson(res));
}

/** Tells Google to invalidate the refresh token. Failures are reported, not thrown. */
export async function revokeToken(refreshToken: string): Promise<boolean> {
  try {
    const res = await fetch(endpoints().revoke, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ token: refreshToken }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

// -------------------------------------------------------------------------- repositories (implemented in lib/google-sync.ts)
export type ConnectionStatus = "active" | "needs_reconnect";
export type SyncStatus = "pending" | "synced" | "failed" | "not_connected";

export interface StoredConnection {
  business_id: string;
  google_email: string;
  refresh_token_encrypted: string;
  calendar_id: string;
  status: ConnectionStatus;
}

export interface SyncPatch {
  status: SyncStatus;
  /** undefined = leave as is, null = clear */
  googleEventId?: string | null;
  error?: string | null;
  retryCount?: number;
  nextAttemptAt?: string | null;
}

export interface SyncRepo {
  getConnection(businessId: string): Promise<StoredConnection | null>;
  setConnectionStatus(businessId: string, status: ConnectionStatus): Promise<void>;
  getSyncContext(appointmentId: string): Promise<SyncContext | null>;
  markSync(appointmentId: string, patch: SyncPatch): Promise<void>;
}

export interface ConnectionRepo extends SyncRepo {
  upsertConnection(row: StoredConnection): Promise<void>;
  deleteConnection(businessId: string): Promise<void>;
  /** Resets every appointment of the business to "not_connected" and forgets event ids. */
  clearSyncState(businessId: string): Promise<void>;
  /** Marks confirmed, future appointments as pending. Returns how many. */
  queueFutureAppointments(businessId: string, nowIso: string): Promise<number>;
  /** Marks failed appointments as pending again with a clean retry counter. Returns how many. */
  requeueFailed(businessId: string, nowIso: string): Promise<number>;
  /** Appointment ids that are due: pending/failed, within the retry limit, next attempt reached. */
  listDue(nowIso: string, limit: number): Promise<string[]>;
}

// -------------------------------------------------------------------------- reconcile
export type SyncOutcome = "skipped" | "synced" | "failed";

function appUrl(): string {
  return process.env.NEXT_PUBLIC_SITE_URL || "https://tornow-eight.vercel.app";
}

/**
 * Brings Google in line with one appointment: confirmed -> event exists and is current,
 * cancelled -> event is gone. One idempotent function, so triggers, retries and backfill all
 * use the same path and a repeated run is always safe.
 */
export async function reconcileAppointment(
  appointmentId: string,
  repo: SyncRepo,
  now: () => Date = () => new Date()
): Promise<SyncOutcome> {
  const ctx = await repo.getSyncContext(appointmentId);
  if (!ctx) return "skipped";
  const { appointment } = ctx;
  // "blocked time" entries have no service and are not customer appointments
  if (!appointment.service_id) return "skipped";

  const connection = await repo.getConnection(appointment.business_id);
  if (!connection) {
    // disconnected meanwhile: do not leave it queued forever
    if (appointment.sync_status && appointment.sync_status !== "not_connected") {
      await repo.markSync(appointmentId, { status: "not_connected", error: null, nextAttemptAt: null });
    }
    return "skipped";
  }
  if (connection.status !== "active") {
    // waits for the owner to reconnect (the reconnect re-queues failed ones)
    if (appointment.sync_status === "pending") {
      await repo.markSync(appointmentId, { status: "failed", error: "google_auth_revoked", nextAttemptAt: null });
    }
    return "skipped";
  }

  const failedBefore = appointment.sync_retry_count ?? 0;
  // If this run dies half way, the retry job finds the row again after a couple of minutes.
  await repo.markSync(appointmentId, {
    status: "pending",
    nextAttemptAt: new Date(now().getTime() + STUCK_GUARD_MINUTES * 60_000).toISOString(),
  });

  try {
    const refreshToken = decryptToken(connection.refresh_token_encrypted, connection.business_id);
    const accessToken = await getAccessToken(connection.business_id, refreshToken, now().getTime());

    if (appointment.status === "confirmed") {
      const eventId = await upsertEvent(
        accessToken,
        connection.calendar_id,
        appointment.id,
        appointment.google_event_id,
        buildEventBody(ctx, appUrl())
      );
      await repo.markSync(appointmentId, {
        status: "synced",
        googleEventId: eventId,
        error: null,
        retryCount: 0,
        nextAttemptAt: null,
      });
    } else {
      await deleteEvent(
        accessToken,
        connection.calendar_id,
        appointment.google_event_id || eventIdForAppointment(appointment.id)
      );
      await repo.markSync(appointmentId, {
        status: "synced",
        googleEventId: null,
        error: null,
        retryCount: 0,
        nextAttemptAt: null,
      });
    }
    return "synced";
  } catch (err) {
    await recordFailure(err, appointment, connection, failedBefore, repo, now());
    return "failed";
  }
}

async function recordFailure(
  err: unknown,
  appointment: Appointment,
  connection: StoredConnection,
  failedBefore: number,
  repo: SyncRepo,
  now: Date
): Promise<void> {
  // Owner has to act (reconnect): no automatic retries until they do.
  if (err instanceof GoogleAuthRevokedError || err instanceof GoogleCalendarMissingError) {
    clearAccessTokenCache(connection.business_id);
    await repo.setConnectionStatus(connection.business_id, "needs_reconnect");
    await repo.markSync(appointment.id, {
      status: "failed",
      error: err.message,
      retryCount: failedBefore,
      nextAttemptAt: null,
    });
    return;
  }

  const reason = err instanceof Error ? err.message : "unknown";
  const retryable = err instanceof GoogleApiError ? err.retryable : false;
  const failures = failedBefore + 1;
  const canRetry = retryable && failures <= MAX_RETRIES;
  await repo.markSync(appointment.id, {
    status: "failed",
    error: reason.slice(0, 200),
    retryCount: failures,
    nextAttemptAt: canRetry ? new Date(now.getTime() + BACKOFF_MINUTES[failures - 1] * 60_000).toISOString() : null,
  });
}

/** Never throws and never blocks a booking: safe to call from `after()` on any write. */
export async function syncAppointmentSafely(appointmentId: string, repo: SyncRepo): Promise<void> {
  try {
    await reconcileAppointment(appointmentId, repo);
  } catch (err) {
    console.error("google calendar sync crashed:", err instanceof Error ? err.name : "unknown");
  }
}

/** Retry job: processes appointments that are due. */
export async function processDueSyncs(
  repo: ConnectionRepo,
  limit = 25,
  now: () => Date = () => new Date()
): Promise<{ processed: number; synced: number; failed: number }> {
  const ids = await repo.listDue(now().toISOString(), limit);
  let synced = 0;
  let failed = 0;
  for (const id of ids) {
    const outcome = await reconcileAppointment(id, repo, now);
    if (outcome === "synced") synced += 1;
    if (outcome === "failed") failed += 1;
  }
  return { processed: ids.length, synced, failed };
}

// -------------------------------------------------------------------------- connect / disconnect
export interface ConnectResult {
  email: string;
  calendarId: string;
}

/**
 * Validates the refresh token (by using it), creates the dedicated calendar, and stores the
 * token encrypted. Appointments that failed while disconnected are queued again.
 */
export async function connectGoogleCalendar(
  input: { businessId: string; googleEmail: string; refreshToken: string },
  repo: ConnectionRepo,
  now: () => Date = () => new Date()
): Promise<ConnectResult> {
  const accessToken = await getAccessToken(input.businessId, input.refreshToken, now().getTime());
  const existing = await repo.getConnection(input.businessId);
  // Reconnecting keeps the existing calendar when it is still there.
  let calendarId = existing?.calendar_id ?? null;
  if (calendarId && calendarId !== "primary") {
    const res = await authorizedFetch(
      accessToken,
      `${endpoints().api}/calendar/v3/calendars/${encodeURIComponent(calendarId)}`
    );
    if (res.status === 404 || res.status === 410) calendarId = null;
  }
  if (!calendarId) calendarId = await createDedicatedCalendar(accessToken);

  await repo.upsertConnection({
    business_id: input.businessId,
    google_email: input.googleEmail,
    refresh_token_encrypted: encryptToken(input.refreshToken, input.businessId),
    calendar_id: calendarId,
    status: "active",
  });
  await repo.requeueFailed(input.businessId, now().toISOString());
  return { email: input.googleEmail, calendarId };
}

/**
 * Revokes the token at Google (best effort), optionally deletes the dedicated calendar,
 * then removes the connection and the sync bookkeeping.
 */
export async function disconnectGoogleCalendar(
  businessId: string,
  repo: ConnectionRepo,
  options: { deleteCalendar: boolean }
): Promise<{ revoked: boolean; calendarDeleted: boolean }> {
  const connection = await repo.getConnection(businessId);
  if (!connection) return { revoked: false, calendarDeleted: false };

  let revoked = false;
  let calendarDeleted = false;
  try {
    const refreshToken = decryptToken(connection.refresh_token_encrypted, businessId);
    if (options.deleteCalendar && connection.calendar_id !== "primary") {
      try {
        const accessToken = await getAccessToken(businessId, refreshToken);
        await deleteCalendar(accessToken, connection.calendar_id);
        calendarDeleted = true;
      } catch {
        calendarDeleted = false;
      }
    }
    revoked = await revokeToken(refreshToken);
  } catch {
    revoked = false;
  }
  clearAccessTokenCache(businessId);
  await repo.deleteConnection(businessId);
  await repo.clearSyncState(businessId);
  return { revoked, calendarDeleted };
}

/** First connection: sync only the FUTURE, confirmed appointments. */
export async function backfillFutureAppointments(
  businessId: string,
  repo: ConnectionRepo,
  options: { inline: number } = { inline: 25 },
  now: () => Date = () => new Date()
): Promise<{ queued: number; processed: number }> {
  const queued = await repo.queueFutureAppointments(businessId, now().toISOString());
  // a first batch right away; the retry job picks up the rest
  const { processed } = await processDueSyncs(repo, options.inline, now);
  return { queued, processed };
}

/** The "retry" button: failed appointments get a clean slate and run now. */
export async function retryFailedSyncs(
  businessId: string,
  repo: ConnectionRepo,
  options: { inline: number } = { inline: 25 },
  now: () => Date = () => new Date()
): Promise<{ requeued: number; processed: number }> {
  const requeued = await repo.requeueFailed(businessId, now().toISOString());
  const { processed } = await processDueSyncs(repo, options.inline, now);
  return { requeued, processed };
}
