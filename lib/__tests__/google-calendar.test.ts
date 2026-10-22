import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { randomBytes } from "crypto";
import {
  BACKOFF_MINUTES,
  backfillFutureAppointments,
  buildEventBody,
  clearAccessTokenCache,
  connectGoogleCalendar,
  disconnectGoogleCalendar,
  eventIdForAppointment,
  processDueSyncs,
  reconcileAppointment,
  retryFailedSyncs,
  syncAppointmentSafely,
  type ConnectionRepo,
  type StoredConnection,
  type SyncContext,
  type SyncPatch,
} from "@/lib/google-calendar";
import { decryptToken, encryptToken } from "@/lib/crypto-token";
import type { Appointment } from "@/lib/types";

// ---------------------------------------------------------------------------- fixtures
const BIZ = "11111111-1111-1111-1111-111111111111";
const APPT = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
const EVENT_ID = "aaaaaaaabbbbccccddddeeeeeeeeeeee";
const NOW = new Date("2026-10-22T10:00:00.000Z");

function appointment(over: Partial<Appointment> = {}): Appointment {
  return {
    id: APPT,
    business_id: BIZ,
    service_id: "svc-1",
    client_id: "cli-1",
    start_time: "2026-10-26T08:00:00.000Z",
    end_time: "2026-10-26T08:35:00.000Z",
    status: "confirmed",
    reminder_sent: false,
    notes: "בלי קצף",
    sync_status: "not_connected",
    sync_retry_count: 0,
    google_event_id: null,
    ...over,
  };
}

function context(over: Partial<Appointment> = {}, settings: SyncContext["business"]["settings"] = {}): SyncContext {
  return {
    appointment: appointment(over),
    service: { name: "תספורת גברים" },
    client: { first_name: "דנה", last_name: "כהן", phone: "0507770099", email: "dana@example.com" },
    business: { id: BIZ, name: "מספרת דניאל", settings },
  };
}

class MemoryRepo implements ConnectionRepo {
  connection: StoredConnection | null = null;
  contexts = new Map<string, SyncContext>();
  marks: { id: string; patch: SyncPatch }[] = [];
  cleared: string[] = [];
  deleted: string[] = [];
  requeued = 0;
  futureQueued = 0;
  due: string[] = [];
  throwOnRead = false;

  async getConnection(businessId: string) {
    if (this.throwOnRead) throw new Error("db down");
    return this.connection && this.connection.business_id === businessId ? { ...this.connection } : null;
  }
  async setConnectionStatus(_businessId: string, status: StoredConnection["status"]) {
    if (this.connection) this.connection.status = status;
  }
  async getSyncContext(id: string) {
    const ctx = this.contexts.get(id);
    return ctx ? structuredClone(ctx) : null;
  }
  async markSync(id: string, patch: SyncPatch) {
    this.marks.push({ id, patch });
    const ctx = this.contexts.get(id);
    if (!ctx) return;
    const a = ctx.appointment;
    a.sync_status = patch.status;
    if (patch.googleEventId !== undefined) a.google_event_id = patch.googleEventId;
    if (patch.error !== undefined) a.sync_error = patch.error;
    if (patch.retryCount !== undefined) a.sync_retry_count = patch.retryCount;
    if (patch.nextAttemptAt !== undefined) a.sync_next_attempt_at = patch.nextAttemptAt;
  }
  async upsertConnection(row: StoredConnection) {
    this.connection = { ...row };
  }
  async deleteConnection(businessId: string) {
    this.deleted.push(businessId);
    this.connection = null;
  }
  async clearSyncState(businessId: string) {
    this.cleared.push(businessId);
  }
  async queueFutureAppointments() {
    return this.futureQueued;
  }
  async requeueFailed() {
    return this.requeued;
  }
  async listDue() {
    return this.due;
  }
  last(id = APPT) {
    return this.contexts.get(id)!.appointment;
  }
}

function connected(repo: MemoryRepo, calendarId = "cal-tornow") {
  repo.connection = {
    business_id: BIZ,
    google_email: "owner@example.com",
    refresh_token_encrypted: encryptToken("refresh-token", BIZ),
    calendar_id: calendarId,
    status: "active",
  };
}

interface Call {
  url: string;
  method: string;
  body: unknown;
}
type Handler = (call: Call) => Response | undefined;

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

/** Replaces fetch. Unhandled token requests succeed; anything else unhandled is a test failure. */
function mockGoogle(handler: Handler = () => undefined) {
  const calls: Call[] = [];
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = String(input);
    const raw = typeof init.body === "string" ? init.body : init.body instanceof URLSearchParams ? init.body.toString() : "";
    let body: unknown = raw;
    try {
      body = JSON.parse(raw);
    } catch {
      /* form body */
    }
    const call: Call = { url, method: init.method ?? "GET", body };
    calls.push(call);
    const custom = handler(call);
    if (custom) return custom;
    if (url.includes("oauth2.googleapis.com/token")) return json(200, { access_token: "at-1", expires_in: 3600 });
    throw new Error(`unexpected request: ${call.method} ${url}`);
  });
  vi.stubGlobal("fetch", fetchMock);
  return { calls, fetchMock, tokenCalls: () => calls.filter((c) => c.url.includes("/token")).length };
}

const isInsert = (c: Call) => c.method === "POST" && c.url.includes("/events");
const eventCalls = (calls: Call[]) => calls.filter((c) => c.url.includes("/events"));

const originalEnv = { ...process.env };
beforeEach(() => {
  process.env.GOOGLE_CLIENT_ID = "client-id";
  process.env.GOOGLE_CLIENT_SECRET = "client-secret";
  process.env.GOOGLE_TOKEN_ENCRYPTION_KEY = randomBytes(32).toString("base64");
  clearAccessTokenCache();
});
afterEach(() => {
  vi.unstubAllGlobals();
  process.env = { ...originalEnv };
});

// ---------------------------------------------------------------------------- tests
describe("event content", () => {
  it("derives a deterministic 32-char event id from the appointment uuid", () => {
    expect(eventIdForAppointment(APPT)).toBe(EVENT_ID);
    expect(EVENT_ID).toMatch(/^[a-v0-9]{32}$/);
  });

  it("builds title, description, Israel time zone and the reminder from the settings", () => {
    const body = buildEventBody(context({}, { calendar_reminder_minutes: 30 }), "https://tornow.example/");
    expect(body.summary).toBe("תספורת גברים - דנה כהן");
    expect(body.description).toContain("טלפון: 0507770099");
    expect(body.description).toContain("אימייל: dana@example.com");
    expect(body.description).toContain("הערות: בלי קצף");
    expect(body.description).toContain("https://tornow.example/admin");
    expect(body.start).toEqual({ dateTime: "2026-10-26T08:00:00.000Z", timeZone: "Asia/Jerusalem" });
    expect(body.end.dateTime).toBe("2026-10-26T08:35:00.000Z");
    expect(body.reminders).toEqual({ useDefault: false, overrides: [{ method: "popup", minutes: 30 }] });
  });

  it("defaults the reminder to one hour and supports 'no reminder'", () => {
    expect(buildEventBody(context(), "https://x").reminders.overrides[0].minutes).toBe(60);
    expect(buildEventBody(context({}, { calendar_reminder_minutes: 0 }), "https://x").reminders.overrides).toEqual([]);
  });
});

describe("create / update / delete", () => {
  it("creates the event with the deterministic id and stores it on the appointment", async () => {
    const repo = new MemoryRepo();
    connected(repo);
    repo.contexts.set(APPT, context());
    const google = mockGoogle((c) =>
      c.method === "POST" && c.url.includes("/calendars/cal-tornow/events") ? json(200, { id: EVENT_ID }) : undefined
    );

    expect(await reconcileAppointment(APPT, repo, () => NOW)).toBe("synced");

    const create = eventCalls(google.calls)[0];
    expect(create.method).toBe("POST");
    expect((create.body as { id: string }).id).toBe(EVENT_ID);
    expect(repo.last()).toMatchObject({ sync_status: "synced", google_event_id: EVENT_ID, sync_retry_count: 0, sync_error: null });
  });

  it("patches the existing event when the appointment is rescheduled", async () => {
    const repo = new MemoryRepo();
    connected(repo);
    repo.contexts.set(
      APPT,
      context({ google_event_id: EVENT_ID, sync_status: "synced", start_time: "2026-10-27T09:00:00.000Z", end_time: "2026-10-27T09:35:00.000Z" })
    );
    const google = mockGoogle((c) => (c.method === "PATCH" ? json(200, { id: EVENT_ID }) : undefined));

    expect(await reconcileAppointment(APPT, repo, () => NOW)).toBe("synced");

    const calls = eventCalls(google.calls);
    expect(calls).toHaveLength(1);
    expect(calls[0].method).toBe("PATCH");
    expect(calls[0].url).toContain(`/events/${EVENT_ID}`);
    expect((calls[0].body as { start: { dateTime: string } }).start.dateTime).toBe("2026-10-27T09:00:00.000Z");
  });

  it("creates the event when the id is missing on a reschedule", async () => {
    const repo = new MemoryRepo();
    connected(repo);
    repo.contexts.set(APPT, context({ google_event_id: null }));
    const google = mockGoogle((c) => (isInsert(c) ? json(200, { id: EVENT_ID }) : undefined));

    await reconcileAppointment(APPT, repo, () => NOW);

    expect(eventCalls(google.calls).map((c) => c.method)).toEqual(["POST"]);
  });

  it("re-creates the event when the owner deleted it by hand (patch -> 404 -> insert)", async () => {
    const repo = new MemoryRepo();
    connected(repo);
    repo.contexts.set(APPT, context({ google_event_id: EVENT_ID }));
    const google = mockGoogle((c) => {
      if (c.method === "PATCH") return json(404, { error: { status: "NOT_FOUND", errors: [{ reason: "notFound" }] } });
      if (isInsert(c)) return json(200, { id: EVENT_ID });
      return undefined;
    });

    expect(await reconcileAppointment(APPT, repo, () => NOW)).toBe("synced");
    expect(eventCalls(google.calls).map((c) => c.method)).toEqual(["PATCH", "POST"]);
  });

  it("is idempotent: a retry that hits 409 (already exists) patches instead of duplicating", async () => {
    const repo = new MemoryRepo();
    connected(repo);
    repo.contexts.set(APPT, context());
    const google = mockGoogle((c) => {
      if (isInsert(c)) return json(409, { error: { errors: [{ reason: "duplicate" }] } });
      if (c.method === "PATCH") return json(200, { id: EVENT_ID });
      return undefined;
    });

    expect(await reconcileAppointment(APPT, repo, () => NOW)).toBe("synced");
    expect(eventCalls(google.calls).map((c) => c.method)).toEqual(["POST", "PATCH"]);
    expect(repo.last().google_event_id).toBe(EVENT_ID);
  });

  it("deletes the event when the appointment is cancelled", async () => {
    const repo = new MemoryRepo();
    connected(repo);
    repo.contexts.set(APPT, context({ status: "cancelled", google_event_id: EVENT_ID, sync_status: "synced" }));
    const google = mockGoogle((c) => (c.method === "DELETE" ? new Response(null, { status: 204 }) : undefined));

    expect(await reconcileAppointment(APPT, repo, () => NOW)).toBe("synced");
    expect(eventCalls(google.calls)[0].method).toBe("DELETE");
    expect(eventCalls(google.calls)[0].url).toContain(`/events/${EVENT_ID}`);
    expect(repo.last()).toMatchObject({ sync_status: "synced", google_event_id: null });
  });

  it.each([404, 410])("treats %i on delete as success", async (status) => {
    const repo = new MemoryRepo();
    connected(repo);
    repo.contexts.set(APPT, context({ status: "cancelled", google_event_id: EVENT_ID }));
    mockGoogle((c) => (c.method === "DELETE" ? json(status, { error: { errors: [{ reason: "deleted" }] } }) : undefined));

    expect(await reconcileAppointment(APPT, repo, () => NOW)).toBe("synced");
    expect(repo.last().sync_status).toBe("synced");
  });

  it("cancelling an appointment that never got an event still succeeds (uses the deterministic id)", async () => {
    const repo = new MemoryRepo();
    connected(repo);
    repo.contexts.set(APPT, context({ status: "cancelled", google_event_id: null }));
    const google = mockGoogle((c) => (c.method === "DELETE" ? json(404, {}) : undefined));

    expect(await reconcileAppointment(APPT, repo, () => NOW)).toBe("synced");
    expect(eventCalls(google.calls)[0].url).toContain(`/events/${EVENT_ID}`);
  });
});

describe("skipping", () => {
  it("does nothing without a connection", async () => {
    const repo = new MemoryRepo();
    repo.contexts.set(APPT, context());
    const google = mockGoogle();
    expect(await reconcileAppointment(APPT, repo, () => NOW)).toBe("skipped");
    expect(google.fetchMock).not.toHaveBeenCalled();
    expect(repo.marks).toHaveLength(0);
  });

  it("does nothing while the connection needs a reconnect", async () => {
    const repo = new MemoryRepo();
    connected(repo);
    repo.connection!.status = "needs_reconnect";
    repo.contexts.set(APPT, context());
    const google = mockGoogle();
    expect(await reconcileAppointment(APPT, repo, () => NOW)).toBe("skipped");
    expect(google.fetchMock).not.toHaveBeenCalled();
  });

  it("ignores blocked-time entries (no service)", async () => {
    const repo = new MemoryRepo();
    connected(repo);
    repo.contexts.set(APPT, context({ service_id: null as unknown as string }));
    const google = mockGoogle();
    expect(await reconcileAppointment(APPT, repo, () => NOW)).toBe("skipped");
    expect(google.fetchMock).not.toHaveBeenCalled();
  });
});

describe("failures never break the booking", () => {
  it("invalid_grant: connection needs a reconnect, the appointment is marked failed, nothing throws", async () => {
    const repo = new MemoryRepo();
    connected(repo);
    repo.contexts.set(APPT, context());
    mockGoogle((c) => (c.url.includes("/token") ? json(400, { error: "invalid_grant" }) : undefined));

    await expect(syncAppointmentSafely(APPT, repo)).resolves.toBeUndefined();

    expect(repo.connection!.status).toBe("needs_reconnect");
    expect(repo.last()).toMatchObject({
      sync_status: "failed",
      sync_error: "google_auth_revoked",
      sync_next_attempt_at: null,
      sync_retry_count: 0,
    });
  });

  it("a deleted dedicated calendar (insert -> 404) asks for a reconnect", async () => {
    const repo = new MemoryRepo();
    connected(repo);
    repo.contexts.set(APPT, context());
    mockGoogle((c) => (isInsert(c) ? json(404, { error: { errors: [{ reason: "notFound" }] } }) : undefined));

    expect(await reconcileAppointment(APPT, repo, () => NOW)).toBe("failed");
    expect(repo.connection!.status).toBe("needs_reconnect");
    expect(repo.last().sync_error).toBe("calendar_not_found");
  });

  it("a transient error schedules retries with the backoff 1, 5, 15, 60, 240 minutes, then gives up", async () => {
    const repo = new MemoryRepo();
    connected(repo);
    repo.contexts.set(APPT, context());
    mockGoogle((c) => (isInsert(c) ? json(503, { error: { errors: [{ reason: "backendError" }] } }) : undefined));

    for (let i = 0; i < BACKOFF_MINUTES.length; i++) {
      expect(await reconcileAppointment(APPT, repo, () => NOW)).toBe("failed");
      const a = repo.last();
      expect(a.sync_status).toBe("failed");
      expect(a.sync_retry_count).toBe(i + 1);
      expect(a.sync_next_attempt_at).toBe(new Date(NOW.getTime() + BACKOFF_MINUTES[i] * 60_000).toISOString());
    }
    // 6th failure: out of retries
    await reconcileAppointment(APPT, repo, () => NOW);
    expect(repo.last()).toMatchObject({ sync_status: "failed", sync_retry_count: 6, sync_next_attempt_at: null });
    expect(repo.last().sync_error).toContain("503");
  });

  it("rate limits are retried, client errors are not", async () => {
    const rate = new MemoryRepo();
    connected(rate);
    rate.contexts.set(APPT, context());
    mockGoogle((c) => (isInsert(c) ? json(403, { error: { errors: [{ reason: "rateLimitExceeded" }] } }) : undefined));
    await reconcileAppointment(APPT, rate, () => NOW);
    expect(rate.last().sync_next_attempt_at).not.toBeNull();

    clearAccessTokenCache();
    const bad = new MemoryRepo();
    connected(bad);
    bad.contexts.set(APPT, context());
    mockGoogle((c) => (isInsert(c) ? json(400, { error: { errors: [{ reason: "invalid" }] } }) : undefined));
    await reconcileAppointment(APPT, bad, () => NOW);
    expect(bad.last()).toMatchObject({ sync_status: "failed", sync_next_attempt_at: null });
  });

  it("a network failure is retryable", async () => {
    const repo = new MemoryRepo();
    connected(repo);
    repo.contexts.set(APPT, context());
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).includes("/token")) return json(200, { access_token: "at-1", expires_in: 3600 });
      throw new TypeError("fetch failed");
    }));
    await reconcileAppointment(APPT, repo, () => NOW);
    expect(repo.last().sync_next_attempt_at).not.toBeNull();
  });

  it("syncAppointmentSafely swallows even a database outage", async () => {
    const repo = new MemoryRepo();
    repo.throwOnRead = true;
    repo.contexts.set(APPT, context());
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    await expect(syncAppointmentSafely(APPT, repo)).resolves.toBeUndefined();
    spy.mockRestore();
  });

  it("never writes tokens into the stored error text", async () => {
    const repo = new MemoryRepo();
    connected(repo);
    repo.contexts.set(APPT, context());
    mockGoogle((c) => (isInsert(c) ? json(500, { error: { message: "leak refresh-token at-1" } }) : undefined));
    await reconcileAppointment(APPT, repo, () => NOW);
    const text = JSON.stringify(repo.marks);
    expect(text).not.toContain("refresh-token");
    expect(text).not.toContain("at-1");
  });
});

describe("access token cache", () => {
  it("asks Google for an access token once for several events", async () => {
    const repo = new MemoryRepo();
    connected(repo);
    repo.contexts.set(APPT, context());
    const second = "ffffffff-bbbb-cccc-dddd-eeeeeeeeeeee";
    repo.contexts.set(second, context({ id: second }));
    const google = mockGoogle((c) => (isInsert(c) ? json(200, { id: "x" }) : undefined));

    await reconcileAppointment(APPT, repo, () => NOW);
    await reconcileAppointment(second, repo, () => NOW);

    expect(google.tokenCalls()).toBe(1);
  });

  it("refreshes again after the token expired", async () => {
    const repo = new MemoryRepo();
    connected(repo);
    repo.contexts.set(APPT, context());
    const google = mockGoogle((c) => (isInsert(c) ? json(200, { id: "x" }) : undefined));

    await reconcileAppointment(APPT, repo, () => NOW);
    await reconcileAppointment(APPT, repo, () => new Date(NOW.getTime() + 2 * 3600_000));

    expect(google.tokenCalls()).toBe(2);
  });
});

describe("retry job, backfill, retry button", () => {
  it("processes only what the repository says is due", async () => {
    const repo = new MemoryRepo();
    connected(repo);
    repo.contexts.set(APPT, context({ sync_status: "failed", sync_retry_count: 2 }));
    repo.due = [APPT];
    mockGoogle((c) => (isInsert(c) ? json(200, { id: EVENT_ID }) : undefined));

    const result = await processDueSyncs(repo, 25, () => NOW);

    expect(result).toEqual({ processed: 1, synced: 1, failed: 0 });
    expect(repo.last()).toMatchObject({ sync_status: "synced", sync_retry_count: 0 });
  });

  it("backfill queues future appointments and runs a first batch", async () => {
    const repo = new MemoryRepo();
    connected(repo);
    repo.contexts.set(APPT, context({ sync_status: "pending" }));
    repo.futureQueued = 1;
    repo.due = [APPT];
    mockGoogle((c) => (isInsert(c) ? json(200, { id: EVENT_ID }) : undefined));

    expect(await backfillFutureAppointments(BIZ, repo, { inline: 25 }, () => NOW)).toEqual({ queued: 1, processed: 1 });
  });

  it("the retry button requeues failed appointments and runs them", async () => {
    const repo = new MemoryRepo();
    connected(repo);
    repo.contexts.set(APPT, context({ sync_status: "failed", sync_retry_count: 6 }));
    repo.requeued = 1;
    repo.due = [APPT];
    mockGoogle((c) => (isInsert(c) ? json(200, { id: EVENT_ID }) : undefined));

    expect(await retryFailedSyncs(BIZ, repo, { inline: 25 }, () => NOW)).toEqual({ requeued: 1, processed: 1 });
    expect(repo.last().sync_status).toBe("synced");
  });
});

describe("connect and disconnect", () => {
  it("creates the dedicated calendar and stores the token encrypted", async () => {
    const repo = new MemoryRepo();
    repo.requeued = 3;
    const google = mockGoogle((c) =>
      c.method === "POST" && c.url.endsWith("/calendar/v3/calendars") ? json(200, { id: "cal-new" }) : undefined
    );

    const result = await connectGoogleCalendar(
      { businessId: BIZ, googleEmail: "owner@example.com", refreshToken: "refresh-token" },
      repo,
      () => NOW
    );

    expect(result).toEqual({ email: "owner@example.com", calendarId: "cal-new" });
    const created = google.calls.find((c) => c.url.endsWith("/calendar/v3/calendars"))!;
    expect(created.body).toMatchObject({ summary: "TorNow – תורים", timeZone: "Asia/Jerusalem" });
    expect(repo.connection!.refresh_token_encrypted).not.toContain("refresh-token");
    expect(decryptToken(repo.connection!.refresh_token_encrypted, BIZ)).toBe("refresh-token");
    expect(repo.connection).toMatchObject({ status: "active", calendar_id: "cal-new" });
  });

  it("keeps the existing calendar when reconnecting, and makes a new one if it was deleted", async () => {
    const repo = new MemoryRepo();
    connected(repo, "cal-old");
    const keep = mockGoogle((c) => (c.method === "GET" && c.url.includes("/calendars/cal-old") ? json(200, { id: "cal-old" }) : undefined));
    expect((await connectGoogleCalendar({ businessId: BIZ, googleEmail: "o@x.com", refreshToken: "t" }, repo, () => NOW)).calendarId).toBe("cal-old");
    expect(keep.calls.some((c) => c.method === "POST" && c.url.endsWith("/calendars"))).toBe(false);

    clearAccessTokenCache();
    mockGoogle((c) => {
      if (c.method === "GET" && c.url.includes("/calendars/cal-old")) return json(404, {});
      if (c.method === "POST" && c.url.endsWith("/calendars")) return json(200, { id: "cal-fresh" });
      return undefined;
    });
    expect((await connectGoogleCalendar({ businessId: BIZ, googleEmail: "o@x.com", refreshToken: "t" }, repo, () => NOW)).calendarId).toBe("cal-fresh");
  });

  it("rejects a refresh token Google no longer accepts", async () => {
    const repo = new MemoryRepo();
    mockGoogle((c) => (c.url.includes("/token") ? json(400, { error: "invalid_grant" }) : undefined));
    await expect(
      connectGoogleCalendar({ businessId: BIZ, googleEmail: "o@x.com", refreshToken: "bad" }, repo, () => NOW)
    ).rejects.toThrow("google_auth_revoked");
    expect(repo.connection).toBeNull();
  });

  it("disconnect revokes the token, can delete the calendar, and forgets the connection", async () => {
    const repo = new MemoryRepo();
    connected(repo, "cal-tornow");
    const google = mockGoogle((c) => {
      if (c.url.includes("/revoke")) return json(200, {});
      if (c.method === "DELETE") return new Response(null, { status: 204 });
      return undefined;
    });

    const result = await disconnectGoogleCalendar(BIZ, repo, { deleteCalendar: true });

    expect(result).toEqual({ revoked: true, calendarDeleted: true });
    expect(google.calls.some((c) => c.url.includes("/revoke"))).toBe(true);
    expect(google.calls.some((c) => c.method === "DELETE" && c.url.endsWith("/calendars/cal-tornow"))).toBe(true);
    expect(repo.deleted).toEqual([BIZ]);
    expect(repo.cleared).toEqual([BIZ]);
  });

  it("disconnect still removes the connection when Google is unreachable", async () => {
    const repo = new MemoryRepo();
    connected(repo);
    vi.stubGlobal("fetch", vi.fn(async () => {
      throw new TypeError("offline");
    }));
    const result = await disconnectGoogleCalendar(BIZ, repo, { deleteCalendar: true });
    expect(result.revoked).toBe(false);
    expect(repo.connection).toBeNull();
    expect(repo.cleared).toEqual([BIZ]);
  });
});
