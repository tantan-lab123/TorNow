import { vi } from "vitest";
import type { FinishPatch, SmsOutboxRow, SmsRepo } from "@/lib/sms/outbox";
import type { Appointment, Business, BusinessSettings } from "@/lib/types";

/** Shared fakes for the SMS tests: no network, no database. */

export const NOW = new Date("2026-11-01T08:00:00Z");

export const ENV = {
  SMS_019_API_TOKEN: "tok",
  SMS_019_USERNAME: "user",
  SMS_019_SOURCE: "TorNow",
  NEXT_PUBLIC_SITE_URL: "https://tornow.example",
};

export const BIZ_ID = "biz";

export function appt(over: Partial<Appointment> = {}): Appointment {
  return {
    id: "appt-1",
    business_id: BIZ_ID,
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

export function biz(settings?: BusinessSettings, over: Partial<Business> = {}): Business {
  return { id: BIZ_ID, name: "סלון נועה", slug: "salon-noa", settings, ...over } as unknown as Business;
}

export type FakeRow = SmsOutboxRow & {
  error?: string | null;
  shipment?: string | null;
  business_id?: string | null;
  segments?: number | null;
  for_start_time?: string | null;
};

/**
 * In-memory repo with the contract of the database one: atomic claim, one message per appointment and
 * kind (reminders: per appointment and appointment time) and the per-phone count (pending + sent only).
 * `clock` is the time rows are created at.
 */
export function fakeRepo(
  appointment: Appointment | null = appt(),
  business: Business | null = biz(),
  clock: () => Date = () => NOW
) {
  const rows = new Map<string, FakeRow>();
  const tokens: { id: string; hash: string; expires: string }[] = [];
  let seq = 0;
  const repo: SmsRepo = {
    async insert(r) {
      const startMs = r.forStartTime ? new Date(r.forStartTime).getTime() : null;
      const exists = [...rows.values()].some((x) =>
        r.kind === "reminder"
          ? x.appointment_id === r.appointmentId &&
            x.kind === "reminder" &&
            !!x.for_start_time &&
            new Date(x.for_start_time).getTime() === startMs
          : x.appointment_id === r.appointmentId && x.kind === r.kind
      );
      if (exists) return null;
      const id = `out-${++seq}`;
      rows.set(id, {
        id,
        appointment_id: r.appointmentId,
        business_id: r.businessId ?? null,
        for_start_time: r.kind === "reminder" ? (r.forStartTime ?? null) : null,
        kind: r.kind,
        to_phone: r.toPhone,
        status: r.status,
        attempts: 0,
        next_attempt_at: clock().toISOString(),
        created_at: clock().toISOString(),
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
      if (patch.segments !== undefined) r.segments = patch.segments;
    },
    async setToken(id, hash, expires) {
      tokens.push({ id, hash, expires });
    },
    async getAppointment() {
      return appointment;
    },
    async getReminderStart(id) {
      return rows.get(id)?.for_start_time ?? null;
    },
    async countRecentByPhone(phone, sinceIso, opts = {}) {
      return [...rows.values()].filter(
        (r) =>
          r.to_phone === phone &&
          (r.status === "pending" || r.status === "sent") &&
          r.created_at >= sinceIso &&
          r.id !== opts.excludeId &&
          (!opts.createdUpToIso || r.created_at <= opts.createdUpToIso)
      ).length;
    },
    async getBusiness() {
      return business;
    },
  };
  return { repo, rows, tokens };
}

/** A fresh Response per call: a body can only be read once. */
export const ok = () =>
  vi.fn().mockImplementation(async () => new Response(JSON.stringify({ status: 0, shipment_id: "S1" })));
export const providerError = (status: number) =>
  vi.fn().mockImplementation(async () => new Response(JSON.stringify({ status, message: "x" })));

export const ctx = (fetchImpl: ReturnType<typeof vi.fn>, now: Date = NOW) => ({
  env: ENV,
  now: () => now,
  send: { fetchImpl: fetchImpl as unknown as typeof fetch },
});
