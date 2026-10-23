import { describe, expect, it, vi } from "vitest";
import {
  BACKOFF_MINUTES,
  MAX_ATTEMPTS,
  enqueueBookedSms,
  planAfterFailure,
  processDueSms,
  processSmsRow,
  skipReason,
  type FinishPatch,
  type SmsOutboxRow,
  type SmsRepo,
} from "@/lib/sms/outbox";
import type { Appointment } from "@/lib/types";

const NOW = new Date("2026-11-01T08:00:00Z");
const ENV = {
  SMS_019_API_TOKEN: "tok",
  SMS_019_USERNAME: "user",
  SMS_019_SOURCE: "TorNow",
  NEXT_PUBLIC_SITE_URL: "https://tornow.example",
};

function appt(over: Partial<Appointment> = {}): Appointment {
  return {
    id: "appt-1",
    business_id: "biz",
    service_id: "svc",
    client_id: "cli",
    status: "confirmed",
    start_time: "2026-11-05T13:30:00Z",
    end_time: "2026-11-05T14:15:00Z",
    client: { first_name: "דנה" },
    business: { name: "סלון נועה" },
    service: { name: "תספורת" },
    ...over,
  } as unknown as Appointment;
}

/** In-memory repo with the same contract as the database one (atomic claim, unique kind). */
function fakeRepo(appointment: Appointment | null = appt()) {
  const rows = new Map<string, SmsOutboxRow & { error?: string | null; shipment?: string | null }>();
  const tokens: { id: string; hash: string; expires: string }[] = [];
  let seq = 0;
  const repo: SmsRepo = {
    async insert(r) {
      if ([...rows.values()].some((x) => x.appointment_id === r.appointmentId && x.kind === r.kind)) return null;
      const id = `out-${++seq}`;
      rows.set(id, {
        id,
        appointment_id: r.appointmentId,
        kind: r.kind,
        to_phone: r.toPhone,
        status: r.status,
        attempts: 0,
        next_attempt_at: NOW.toISOString(),
        error: r.errorCode ?? null,
      });
      return { id };
    },
    async claim(id, nowIso, leaseUntil) {
      const r = rows.get(id);
      if (!r || r.status !== "pending" || r.next_attempt_at > nowIso) return null;
      r.attempts += 1;
      r.next_attempt_at = leaseUntil;
      return { ...r };
    },
    async listDue(nowIso, limit) {
      return [...rows.values()]
        .filter((r) => r.status === "pending" && r.next_attempt_at <= nowIso)
        .slice(0, limit)
        .map((r) => r.id);
    },
    async finish(id, patch: FinishPatch) {
      const r = rows.get(id)!;
      r.status = patch.status;
      if (patch.nextAttemptAt) r.next_attempt_at = patch.nextAttemptAt;
      if (patch.errorCode !== undefined) r.error = patch.errorCode;
      if (patch.shipmentId !== undefined) r.shipment = patch.shipmentId;
    },
    async setToken(id, hash, expires) {
      tokens.push({ id, hash, expires });
    },
    async getAppointment() {
      return appointment;
    },
  };
  return { repo, rows, tokens };
}

// a fresh Response per call: a body can only be read once
const ok = () => vi.fn().mockImplementation(async () => new Response(JSON.stringify({ status: 0, shipment_id: "S1" })));
const providerError = (status: number) =>
  vi.fn().mockImplementation(async () => new Response(JSON.stringify({ status, message: "x" })));
const ctx = (fetchImpl: ReturnType<typeof vi.fn>, now: Date = NOW) => ({
  env: ENV,
  now: () => now,
  send: { fetchImpl: fetchImpl as unknown as typeof fetch },
});

describe("enqueueBookedSms", () => {
  it("queues a pending row with the normalized phone", async () => {
    const { repo, rows } = fakeRepo();
    const r = await enqueueBookedSms({ appointmentId: "appt-1", phone: "0501234567" }, repo, { env: ENV });
    expect(r?.status).toBe("pending");
    expect([...rows.values()][0]).toMatchObject({ kind: "booked", to_phone: "501234567", status: "pending" });
  });

  it("records skipped (with the reason) when 019 is not configured: the booking is unaffected", async () => {
    const { repo, rows } = fakeRepo();
    const r = await enqueueBookedSms({ appointmentId: "appt-1", phone: "0501234567" }, repo, { env: {} });
    expect(r?.status).toBe("skipped");
    expect([...rows.values()][0]).toMatchObject({ status: "skipped", error: "sms_not_configured" });
  });

  it("skips an invalid or non-Israeli number and a missing site url", async () => {
    const a = fakeRepo();
    await enqueueBookedSms({ appointmentId: "a1", phone: "0212345678" }, a.repo, { env: ENV });
    expect([...a.rows.values()][0]).toMatchObject({ status: "skipped", error: "phone_not_israeli_mobile" });
    const b = fakeRepo();
    await enqueueBookedSms({ appointmentId: "a2", phone: "0501234567" }, b.repo, { env: { ...ENV, NEXT_PUBLIC_SITE_URL: "" } });
    expect([...b.rows.values()][0]).toMatchObject({ status: "skipped", error: "site_url_missing" });
  });

  it("is idempotent per appointment and kind", async () => {
    const { repo, rows } = fakeRepo();
    await enqueueBookedSms({ appointmentId: "appt-1", phone: "0501234567" }, repo, { env: ENV });
    const again = await enqueueBookedSms({ appointmentId: "appt-1", phone: "0501234567" }, repo, { env: ENV });
    expect(again).toBeNull();
    expect(rows.size).toBe(1);
  });

  it("never throws when the database does", async () => {
    const { repo } = fakeRepo();
    repo.insert = async () => {
      throw new Error("relation sms_outbox does not exist");
    };
    await expect(enqueueBookedSms({ appointmentId: "x", phone: "0501234567" }, repo, { env: ENV })).resolves.toBeNull();
  });
});

describe("processSmsRow state transitions", () => {
  it("pending -> sent, stores the shipment id, sends the id as external_id and a link with a fresh token", async () => {
    const { repo, rows, tokens } = fakeRepo();
    const q = await enqueueBookedSms({ appointmentId: "appt-1", phone: "0501234567" }, repo, { env: ENV });
    const fetchImpl = ok();
    expect(await processSmsRow(q!.id, repo, ctx(fetchImpl))).toBe("sent");

    expect(rows.get(q!.id)).toMatchObject({ status: "sent", shipment: "S1", attempts: 1 });
    const body = JSON.parse(fetchImpl.mock.calls[0][1].body);
    expect(body.sms.destinations.phone[0]).toEqual({ $: { id: q!.id }, _: "501234567" });
    expect(body.sms.message).toMatch(/^שלום דנה, נקבע לך תור לסלון נועה בתאריך 05\/11 בשעה 15:30\./);
    const link = body.sms.message.split("\n").pop() as string;
    expect(link).toMatch(/^https:\/\/tornow\.example\/t\/[A-Za-z0-9_-]{32}$/);
    // only the hash of that token is stored, valid until the end of the appointment
    expect(tokens).toHaveLength(1);
    expect(tokens[0].expires).toBe("2026-11-05T14:15:00Z");
    expect(tokens[0].hash).not.toContain(link.split("/t/")[1]);
  });

  it("a retryable failure backs off 1, 5, 15, 60, 180 minutes, with a NEW token each time, then ends failed", async () => {
    const { repo, rows, tokens } = fakeRepo();
    const q = await enqueueBookedSms({ appointmentId: "appt-1", phone: "0501234567" }, repo, { env: ENV });
    let now = NOW;
    const fetchImpl = providerError(4); // no balance
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      const outcome = await processSmsRow(q!.id, repo, ctx(fetchImpl, now));
      const row = rows.get(q!.id)!;
      if (attempt < MAX_ATTEMPTS) {
        expect(outcome).toBe("retry");
        expect(row.status).toBe("pending");
        expect(new Date(row.next_attempt_at).getTime() - now.getTime()).toBe(BACKOFF_MINUTES[attempt - 1] * 60_000);
        // not due before the backoff has passed
        expect(await processSmsRow(q!.id, repo, ctx(fetchImpl, new Date(now.getTime() + 30_000)))).toBe("busy");
        now = new Date(row.next_attempt_at);
      } else {
        expect(outcome).toBe("failed");
        expect(row.status).toBe("failed");
      }
    }
    expect(rows.get(q!.id)).toMatchObject({ attempts: MAX_ATTEMPTS, error: "4" });
    expect(new Set(tokens.map((t) => t.hash)).size).toBe(MAX_ATTEMPTS);
  });

  it("a permanent failure (blocked number) is failed at once", async () => {
    const { repo, rows } = fakeRepo();
    const q = await enqueueBookedSms({ appointmentId: "appt-1", phone: "0501234567" }, repo, { env: ENV });
    expect(await processSmsRow(q!.id, repo, ctx(providerError(715)))).toBe("failed");
    expect(rows.get(q!.id)).toMatchObject({ status: "failed", attempts: 1, error: "715" });
  });

  it("logs a token problem loudly and keeps the message for a retry", async () => {
    const { repo, rows } = fakeRepo();
    const q = await enqueueBookedSms({ appointmentId: "appt-1", phone: "0501234567" }, repo, { env: ENV });
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await processSmsRow(q!.id, repo, ctx(providerError(11)))).toBe("retry");
    expect(err).toHaveBeenCalledWith(expect.stringContaining("configuration problem"));
    err.mockRestore();
    expect(rows.get(q!.id)!.status).toBe("pending");
  });

  it("skips a cancelled or past appointment without calling the provider", async () => {
    for (const a of [appt({ status: "cancelled" }), appt({ start_time: "2026-10-30T10:00:00Z" }), null]) {
      const { repo, rows } = fakeRepo(a);
      const q = await enqueueBookedSms({ appointmentId: "appt-1", phone: "0501234567" }, repo, { env: ENV });
      const fetchImpl = ok();
      expect(await processSmsRow(q!.id, repo, ctx(fetchImpl))).toBe("skipped");
      expect(fetchImpl).not.toHaveBeenCalled();
      expect(rows.get(q!.id)!.status).toBe("skipped");
    }
    expect(skipReason(appt(), NOW)).toBeNull();
  });

  it("two racing workers send exactly once", async () => {
    const { repo } = fakeRepo();
    const q = await enqueueBookedSms({ appointmentId: "appt-1", phone: "0501234567" }, repo, { env: ENV });
    const fetchImpl = ok();
    const results = await Promise.all([
      processSmsRow(q!.id, repo, ctx(fetchImpl)),
      processSmsRow(q!.id, repo, ctx(fetchImpl)),
    ]);
    expect(results.sort()).toEqual(["busy", "sent"]);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("a crash after the claim counts as an attempt and leaves the row for the cron job", async () => {
    const { repo, rows } = fakeRepo();
    repo.getAppointment = async () => {
      throw new Error("db down");
    };
    const q = await enqueueBookedSms({ appointmentId: "appt-1", phone: "0501234567" }, repo, { env: ENV });
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await processSmsRow(q!.id, repo, ctx(ok()))).toBe("retry");
    err.mockRestore();
    expect(rows.get(q!.id)).toMatchObject({ status: "pending", attempts: 1, error: "internal" });
  });
});

describe("planAfterFailure / processDueSms", () => {
  it("only retryable failures with attempts left stay pending", () => {
    expect(planAfterFailure({ retryable: true }, 1, NOW).status).toBe("pending");
    expect(planAfterFailure({ retryable: true }, MAX_ATTEMPTS, NOW).status).toBe("failed");
    expect(planAfterFailure({ retryable: false }, 1, NOW).status).toBe("failed");
  });

  it("the cron pass sends what is due and leaves the rest", async () => {
    const { repo, rows } = fakeRepo();
    const a = await enqueueBookedSms({ appointmentId: "appt-1", phone: "0501234567" }, repo, { env: ENV });
    const b = await enqueueBookedSms({ appointmentId: "appt-2", phone: "0521234567" }, repo, { env: ENV });
    rows.get(b!.id)!.next_attempt_at = "2026-11-01T09:00:00Z"; // later
    const res = await processDueSms(repo, { limit: 10 }, ctx(ok()));
    expect(res).toMatchObject({ processed: 1, sent: 1 });
    expect(rows.get(a!.id)!.status).toBe("sent");
    expect(rows.get(b!.id)!.status).toBe("pending");
  });
});
