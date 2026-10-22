import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "http";
import type { AddressInfo } from "net";
import { randomBytes } from "crypto";

/**
 * Wiring test: the real database layer (in-memory variant, as in local development) and the real
 * sync code, talking HTTP to a small fake Google. Verifies the whole path a booking takes.
 */

const BIZ = "a1111111-1111-1111-1111-111111111111"; // seeded sample business

interface Recorded {
  method: string;
  path: string;
  body: Record<string, unknown> | null;
}

let server: Server;
let recorded: Recorded[] = [];
let failEvents: number | null = null; // when set, event requests answer with this status
const events = new Map<string, Record<string, unknown>>();

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    let data = "";
    req.on("data", (c) => (data += c));
    req.on("end", () => resolve(data));
  });
}

function send(res: ServerResponse, status: number, body?: unknown) {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(body === undefined ? undefined : JSON.stringify(body));
}

beforeAll(async () => {
  server = createServer(async (req, res) => {
    const raw = await readBody(req);
    let body: Record<string, unknown> | null = null;
    try {
      body = JSON.parse(raw);
    } catch {
      body = null;
    }
    const path = (req.url ?? "").split("?")[0];
    const method = req.method ?? "GET";
    recorded.push({ method, path, body });

    if (path === "/token") return send(res, 200, { access_token: "fake-access", expires_in: 3600 });
    if (path === "/revoke") return send(res, 200, {});
    if (path === "/calendar/v3/calendars" && method === "POST") return send(res, 200, { id: "cal-fake" });
    if (path.startsWith("/calendar/v3/calendars/cal-fake") && !path.includes("/events")) {
      return method === "DELETE" ? send(res, 204) : send(res, 200, { id: "cal-fake" });
    }
    if (path.includes("/events")) {
      if (failEvents) return send(res, failEvents, { error: { errors: [{ reason: "backendError" }] } });
      const id = path.split("/events/")[1]?.split("?")[0];
      if (method === "POST") {
        const newId = String(body?.id);
        if (events.has(newId)) return send(res, 409, { error: { errors: [{ reason: "duplicate" }] } });
        events.set(newId, body ?? {});
        return send(res, 200, { id: newId });
      }
      if (method === "PATCH" && id) {
        if (!events.has(id)) return send(res, 404, {});
        events.set(id, { ...events.get(id), ...body });
        return send(res, 200, { id });
      }
      if (method === "DELETE" && id) {
        const existed = events.delete(id);
        return existed ? send(res, 204) : send(res, 410, {});
      }
    }
    return send(res, 500, { error: "unhandled in fake google" });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  process.env.GOOGLE_API_BASE = base;
  process.env.GOOGLE_TOKEN_URL = `${base}/token`;
  process.env.GOOGLE_REVOKE_URL = `${base}/revoke`;
  process.env.GOOGLE_CLIENT_ID = "client-id";
  process.env.GOOGLE_CLIENT_SECRET = "client-secret";
  process.env.GOOGLE_TOKEN_ENCRYPTION_KEY = randomBytes(32).toString("base64");
});

afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

beforeEach(() => {
  recorded = [];
  failEvents = null;
  events.clear();
});

async function load() {
  const sync = await import("@/lib/google-sync");
  const db = await import("@/lib/db");
  const calendar = await import("@/lib/google-calendar");
  const mock = await import("@/lib/db/mock-data");
  return { sync, db, calendar, mock };
}

async function newAppointment(startIso: string) {
  const { db, mock } = await load();
  const service = mock.INITIAL_SERVICES.find((s) => s.business_id === BIZ)!;
  const client = mock.INITIAL_CLIENTS.find((c) => c.business_id === BIZ)!;
  const end = new Date(new Date(startIso).getTime() + 35 * 60_000).toISOString();
  return db.createAppointment({
    business_id: BIZ,
    service_id: service.id,
    client_id: client.id,
    start_time: startIso,
    end_time: end,
  });
}

const eventCalls = () => recorded.filter((r) => r.path.includes("/events"));
const future = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString();

describe("google calendar sync, end to end (in-memory db + fake google)", () => {
  it("not connected: a booking is left alone and Google is never called", async () => {
    const { sync, db } = await load();
    const appt = await newAppointment(future(3));
    await sync.syncAppointment(appt.id);
    expect(recorded).toHaveLength(0);
    expect((await db.getAppointmentById(appt.id))?.sync_status ?? "not_connected").toBe("not_connected");
    expect(await sync.getCalendarStatus(BIZ)).toMatchObject({ connected: false, needsReconnect: false, failedCount: 0 });
  });

  it("connect -> book -> reschedule -> cancel keeps Google in step, then disconnect cleans up", async () => {
    const { sync, db } = await load();

    // connect: validates the token, creates the dedicated calendar, stores it encrypted
    await sync.connectCalendar({ businessId: BIZ, googleEmail: "owner@example.com", refreshToken: "refresh-1" });
    const stored = await db.getGoogleConnection(BIZ);
    expect(stored).toMatchObject({ calendar_id: "cal-fake", status: "active", google_email: "owner@example.com" });
    expect(stored!.refresh_token_encrypted).not.toContain("refresh-1");
    expect(recorded.some((r) => r.path === "/calendar/v3/calendars" && r.method === "POST")).toBe(true);

    // status shows only safe fields
    const status = await sync.getCalendarStatus(BIZ);
    expect(status).toMatchObject({ connected: true, email: "owner@example.com" });
    expect(JSON.stringify(status)).not.toMatch(/token|refresh/i);

    // book
    const appt = await newAppointment(future(4));
    await sync.syncAppointment(appt.id);
    const created = (await db.getAppointmentById(appt.id))!;
    expect(created.sync_status).toBe("synced");
    expect(created.google_event_id).toBe(appt.id.replace(/-/g, ""));
    expect(eventCalls().map((r) => r.method)).toEqual(["POST"]);
    expect(events.size).toBe(1);

    // running the same sync again never duplicates
    await sync.syncAppointment(appt.id);
    expect(events.size).toBe(1);

    // reschedule
    const newStart = future(5);
    await db.rescheduleAppointment(appt.id, newStart, new Date(new Date(newStart).getTime() + 35 * 60_000).toISOString());
    recorded = [];
    await sync.syncAppointment(appt.id);
    expect(eventCalls().map((r) => r.method)).toEqual(["PATCH"]);
    const patched = events.get(appt.id.replace(/-/g, ""))!;
    expect((patched.start as { dateTime: string }).dateTime).toBe(new Date(newStart).toISOString());

    // cancel
    await db.updateAppointmentStatus(appt.id, "cancelled");
    recorded = [];
    await sync.syncAppointment(appt.id);
    expect(eventCalls().map((r) => r.method)).toEqual(["DELETE"]);
    expect(events.size).toBe(0);
    expect((await db.getAppointmentById(appt.id))?.sync_status).toBe("synced");

    // disconnect: token revoked, calendar deleted, bookkeeping cleared
    recorded = [];
    const result = await sync.disconnectCalendar(BIZ, { deleteCalendar: true });
    expect(result).toEqual({ revoked: true, calendarDeleted: true });
    expect(recorded.some((r) => r.path === "/revoke")).toBe(true);
    expect(await db.getGoogleConnection(BIZ)).toBeNull();
    expect((await db.getAppointmentById(appt.id))?.sync_status).toBe("not_connected");
  });

  it("a Google outage never breaks the booking; the retry job catches up", async () => {
    const { sync, db } = await load();
    await sync.connectCalendar({ businessId: BIZ, googleEmail: "owner@example.com", refreshToken: "refresh-2" });

    failEvents = 503;
    const appt = await newAppointment(future(6)); // the booking itself succeeded
    await sync.syncAppointment(appt.id);
    let row = (await db.getAppointmentById(appt.id))!;
    expect(row.sync_status).toBe("failed");
    expect(row.sync_retry_count).toBe(1);
    expect(row.sync_next_attempt_at).toBeTruthy();
    expect(row.sync_error).toContain("503");
    expect(await sync.getCalendarStatus(BIZ)).toMatchObject({ failedCount: 1 });

    // not due yet
    expect(await sync.runDueCalendarSyncs(25)).toMatchObject({ processed: 0 });

    // Google recovers and the backoff time passes
    failEvents = null;
    await db.markAppointmentSync(appt.id, { status: "failed", nextAttemptAt: new Date(Date.now() - 1000).toISOString() });
    expect(await sync.runDueCalendarSyncs(25)).toMatchObject({ processed: 1, synced: 1, failed: 0 });
    row = (await db.getAppointmentById(appt.id))!;
    expect(row).toMatchObject({ sync_status: "synced", sync_retry_count: 0 });
    expect(await sync.getCalendarStatus(BIZ)).toMatchObject({ failedCount: 0 });

    await sync.disconnectCalendar(BIZ, { deleteCalendar: false });
  });

  it("the retry button gives failed appointments a clean slate", async () => {
    const { sync, db } = await load();
    await sync.connectCalendar({ businessId: BIZ, googleEmail: "owner@example.com", refreshToken: "refresh-3" });

    failEvents = 500;
    const appt = await newAppointment(future(7));
    await sync.syncAppointment(appt.id);
    // exhaust the automatic retries
    await db.markAppointmentSync(appt.id, { status: "failed", retryCount: 6, nextAttemptAt: null });
    expect(await sync.runDueCalendarSyncs(25)).toMatchObject({ processed: 0 });

    failEvents = null;
    expect(await sync.retryCalendar(BIZ)).toMatchObject({ requeued: 1, processed: 1 });
    expect((await db.getAppointmentById(appt.id))?.sync_status).toBe("synced");
    await sync.disconnectCalendar(BIZ, { deleteCalendar: false });
  });

  it("first connection backfills only FUTURE confirmed appointments", async () => {
    const { sync, db } = await load();
    const past = await newAppointment(new Date(Date.now() - 3 * 86_400_000).toISOString());
    const upcoming = await newAppointment(future(8));
    const cancelled = await newAppointment(future(9));
    await db.updateAppointmentStatus(cancelled.id, "cancelled");

    await sync.connectCalendar({ businessId: BIZ, googleEmail: "owner@example.com", refreshToken: "refresh-4" });
    recorded = [];
    const result = await sync.backfillCalendar(BIZ);

    expect(result.queued).toBeGreaterThanOrEqual(1);
    expect((await db.getAppointmentById(upcoming.id))?.sync_status).toBe("synced");
    expect(events.has(upcoming.id.replace(/-/g, ""))).toBe(true);
    expect(events.has(past.id.replace(/-/g, ""))).toBe(false);
    expect(events.has(cancelled.id.replace(/-/g, ""))).toBe(false);
    expect((await db.getAppointmentById(past.id))?.sync_status ?? "not_connected").toBe("not_connected");
    await sync.disconnectCalendar(BIZ, { deleteCalendar: false });
  });

  it("a revoked token flips the connection to needs_reconnect and stops automatic retries", async () => {
    const { sync, db, calendar } = await load();
    await sync.connectCalendar({ businessId: BIZ, googleEmail: "owner@example.com", refreshToken: "refresh-5" });
    calendar.clearAccessTokenCache(BIZ);

    // the token endpoint now rejects the refresh token
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).endsWith("/token")) {
        return new Response(JSON.stringify({ error: "invalid_grant" }), { status: 400 });
      }
      return realFetch(input, init);
    }) as typeof fetch;
    try {
      const appt = await newAppointment(future(10));
      await sync.syncAppointment(appt.id);
      const row = (await db.getAppointmentById(appt.id))!;
      expect(row).toMatchObject({ sync_status: "failed", sync_error: "google_auth_revoked", sync_next_attempt_at: null });
      expect(await sync.getCalendarStatus(BIZ)).toMatchObject({ connected: false, needsReconnect: true, failedCount: 1 });
      expect(await sync.runDueCalendarSyncs(25)).toMatchObject({ processed: 0 });
    } finally {
      globalThis.fetch = realFetch;
    }

    // reconnecting makes the failed ones run again
    calendar.clearAccessTokenCache(BIZ);
    await sync.connectCalendar({ businessId: BIZ, googleEmail: "owner@example.com", refreshToken: "refresh-6" });
    expect(await sync.runDueCalendarSyncs(25)).toMatchObject({ synced: 1 });
    expect(await sync.getCalendarStatus(BIZ)).toMatchObject({ connected: true, needsReconnect: false, failedCount: 0 });
    await sync.disconnectCalendar(BIZ, { deleteCalendar: false });
  });
});
