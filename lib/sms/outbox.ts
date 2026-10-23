import type { Appointment } from "@/lib/types";
import {
  maskPhone,
  normalizeIsraeliMobile,
  readSmsConfig,
  sendSms019,
  type SendDeps,
  type SendResult,
} from "@/lib/sms/019";
import { generateManageToken, hashManageToken } from "@/lib/sms/manage-token";
import { buildBookedMessage, buildManageUrl } from "@/lib/sms/template";

/**
 * The SMS queue, same idea as the Google Calendar sync: a booking never waits for the
 * provider and never fails because of it. The row is written first, sent right after the
 * response (`after()`), and a cron job retries what is still due.
 */

export type SmsKind = "booked" | "rescheduled" | "cancelled" | "reminder";
export type SmsStatus = "pending" | "sent" | "failed" | "skipped";

/** Delay before retry n (1-based) after the n-th failed attempt. Initial try + 5 retries. */
export const BACKOFF_MINUTES = [1, 5, 15, 60, 180] as const;
export const MAX_ATTEMPTS = BACKOFF_MINUTES.length + 1;
/** While a send is in flight the row is leased for this long; a crash makes it due again. */
export const LEASE_MINUTES = 5;

export interface SmsOutboxRow {
  id: string;
  appointment_id: string;
  kind: SmsKind;
  to_phone: string;
  status: SmsStatus;
  attempts: number;
  next_attempt_at: string;
}

export interface FinishPatch {
  status: SmsStatus;
  nextAttemptAt?: string;
  errorCode?: string | null;
  errorMessage?: string | null;
  shipmentId?: string | null;
}

export interface SmsRepo {
  /** null when this appointment already has a message of this kind (idempotent). */
  insert(row: {
    appointmentId: string;
    kind: SmsKind;
    toPhone: string;
    status: SmsStatus;
    errorCode?: string;
    errorMessage?: string;
  }): Promise<{ id: string } | null>;
  /** Atomic: succeeds for exactly one caller while the row is pending and due. Counts the attempt. */
  claim(id: string, nowIso: string, leaseUntilIso: string): Promise<SmsOutboxRow | null>;
  listDue(nowIso: string, limit: number): Promise<string[]>;
  finish(id: string, patch: FinishPatch): Promise<void>;
  setToken(id: string, hash: string, expiresAtIso: string): Promise<void>;
  getAppointment(appointmentId: string): Promise<Appointment | null>;
}

export interface SmsEnv {
  env?: Record<string, string | undefined>;
  now?: () => Date;
  send?: SendDeps;
}

const minutes = (n: number) => n * 60_000;

// ------------------------------------------------------------------ enqueue

/**
 * Writes the queue row for a new booking. Never throws. A missing configuration or an
 * unusable phone number is recorded as "skipped" with the reason, and the booking goes on.
 */
export async function enqueueBookedSms(
  input: { appointmentId: string; phone: string },
  repo: SmsRepo,
  ctx: SmsEnv = {}
): Promise<{ id: string; status: SmsStatus } | null> {
  try {
    const cfg = readSmsConfig(ctx.env);
    const phone = normalizeIsraeliMobile(input.phone);
    const siteOk = buildManageUrl("x", (ctx.env ?? process.env).NEXT_PUBLIC_SITE_URL) !== null;

    let status: SmsStatus = "pending";
    let reason: string | undefined;
    if (!cfg.ok) {
      status = "skipped";
      reason = cfg.reason;
    } else if (!phone.ok) {
      status = "skipped";
      reason = phone.reason;
    } else if (!siteOk) {
      status = "skipped";
      reason = "site_url_missing";
    }

    const row = await repo.insert({
      appointmentId: input.appointmentId,
      kind: "booked",
      toPhone: phone.ok ? phone.phone : input.phone.replace(/\D/g, "").slice(0, 20),
      status,
      errorCode: reason,
      errorMessage: reason,
    });
    if (reason) console.warn(`sms skipped (${reason})`);
    return row ? { id: row.id, status } : null;
  } catch (err) {
    console.error("sms enqueue failed:", err instanceof Error ? err.name : "unknown");
    return null;
  }
}

// ------------------------------------------------------------------ send one

export type ProcessOutcome = "sent" | "retry" | "failed" | "skipped" | "busy";

function nextAttemptIso(attempts: number, now: Date): string {
  return new Date(now.getTime() + minutes(BACKOFF_MINUTES[Math.min(attempts, BACKOFF_MINUTES.length) - 1])).toISOString();
}

/** What to do with the row after a failed send. */
export function planAfterFailure(
  result: Pick<SendResult, "retryable">,
  attempts: number,
  now: Date
): { status: "pending"; nextAttemptAt: string } | { status: "failed" } {
  if (result.retryable && attempts < MAX_ATTEMPTS) {
    return { status: "pending", nextAttemptAt: nextAttemptIso(attempts, now) };
  }
  return { status: "failed" };
}

/** Why a confirmation must not go out any more (checked right before every send). */
export function skipReason(appointment: Appointment | null, now: Date): string | null {
  if (!appointment) return "appointment_missing";
  if (appointment.status === "cancelled") return "appointment_cancelled";
  if (new Date(appointment.start_time).getTime() <= now.getTime()) return "appointment_past";
  return null;
}

export async function processSmsRow(id: string, repo: SmsRepo, ctx: SmsEnv = {}): Promise<ProcessOutcome> {
  const now = ctx.now ?? (() => new Date());
  const t0 = now();
  const claimed = await repo.claim(id, t0.toISOString(), new Date(t0.getTime() + minutes(LEASE_MINUTES)).toISOString());
  if (!claimed) return "busy";

  try {
    const appointment = await repo.getAppointment(claimed.appointment_id);
    const skip = skipReason(appointment, now());
    if (skip) {
      await repo.finish(id, { status: "skipped", errorCode: skip, errorMessage: skip });
      return "skipped";
    }

    const cfg = readSmsConfig(ctx.env);
    if (!cfg.ok) {
      await repo.finish(id, { status: "skipped", errorCode: cfg.reason, errorMessage: cfg.reason });
      return "skipped";
    }

    // A fresh token for every attempt: the raw one is never stored, so a resend cannot reuse it.
    const token = generateManageToken();
    const manageUrl = buildManageUrl(token, (ctx.env ?? process.env).NEXT_PUBLIC_SITE_URL);
    if (!manageUrl || !appointment) {
      await repo.finish(id, { status: "skipped", errorCode: "site_url_missing", errorMessage: "site_url_missing" });
      return "skipped";
    }
    await repo.setToken(id, hashManageToken(token), appointment.end_time);

    const message = buildBookedMessage({
      firstName: appointment.client?.first_name,
      businessName: appointment.business?.name,
      serviceName: appointment.service?.name,
      start: appointment.start_time,
      manageUrl,
    });

    const result = await sendSms019(cfg.config, { id, phone: claimed.to_phone, message }, ctx.send);

    if (result.ok) {
      await repo.finish(id, {
        status: "sent",
        shipmentId: result.shipmentId ?? null,
        errorCode: null,
        errorMessage: null,
      });
      return "sent";
    }

    if (result.errorClass === "config") {
      console.error(`sms 019 configuration problem (status ${result.status ?? "none"}): check SMS_019_API_TOKEN / SMS_019_USERNAME`);
    } else {
      console.warn(`sms send failed to ${maskPhone(claimed.to_phone)}: ${result.status ?? result.message}`);
    }
    const plan = planAfterFailure(result, claimed.attempts, now());
    await repo.finish(id, {
      ...plan,
      errorCode: result.status != null ? String(result.status) : result.message ?? "error",
      errorMessage: result.message ?? null,
    });
    return plan.status === "pending" ? "retry" : "failed";
  } catch (err) {
    // Unexpected (e.g. database trouble): count it like a failed attempt, never crash the caller.
    console.error("sms processing crashed:", err instanceof Error ? err.name : "unknown");
    try {
      const plan = planAfterFailure({ retryable: true }, claimed.attempts, now());
      await repo.finish(id, { ...plan, errorCode: "internal", errorMessage: "internal_error" });
    } catch {
      // the lease expires and the cron job picks the row up again
    }
    return "retry";
  }
}

/** Safe for `after()`: never throws. */
export async function processSmsRowSafely(id: string, repo: SmsRepo, ctx: SmsEnv = {}): Promise<void> {
  try {
    await processSmsRow(id, repo, ctx);
  } catch (err) {
    console.error("sms send crashed:", err instanceof Error ? err.name : "unknown");
  }
}

// ------------------------------------------------------------------ cron

export async function processDueSms(
  repo: SmsRepo,
  opts: { limit?: number; budgetMs?: number } = {},
  ctx: SmsEnv = {}
): Promise<{ processed: number; sent: number; retry: number; failed: number; skipped: number }> {
  const now = ctx.now ?? (() => new Date());
  const started = Date.now();
  const ids = await repo.listDue(now().toISOString(), opts.limit ?? 10);
  const tally = { processed: 0, sent: 0, retry: 0, failed: 0, skipped: 0 };
  for (const id of ids) {
    // stay inside the function's time limit: whatever is left is picked up on the next run
    if (Date.now() - started > (opts.budgetMs ?? 40_000)) break;
    const outcome = await processSmsRow(id, repo, ctx);
    if (outcome === "busy") continue;
    tally.processed += 1;
    tally[outcome] += 1;
  }
  return tally;
}
