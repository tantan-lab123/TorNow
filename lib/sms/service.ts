import { recordSmsDelivery, smsRepo } from "@/lib/db/sms";
import { applyDlr, parseDlrDate, parseDlrStatus } from "@/lib/sms/dlr";
import type { BusinessSettings } from "@/lib/types";
import { enqueueBookedSms, processDueSms, processSmsRowSafely } from "@/lib/sms/outbox";

/**
 * Wiring of the SMS core to the real database. Route handlers import from here.
 */

/**
 * Booking confirmation: writes the queue row (never throws) and returns its id, or null when
 * there is nothing to send. Call `sendSmsInBackground(id)` from `after()` afterwards.
 */
export async function queueBookedSms(
  appointmentId: string,
  phone: string,
  business?: { id: string; settings?: BusinessSettings } | null
): Promise<string | null> {
  const row = await enqueueBookedSms({ appointmentId, phone, business }, smsRepo);
  return row && row.status === "pending" ? row.id : null;
}

/** For `after()`. Never throws. */
export function sendSmsInBackground(outboxId: string): Promise<void> {
  return processSmsRowSafely(outboxId, smsRepo);
}

export const runDueSms = (limit = 10) => processDueSms(smsRepo, { limit });

/**
 * One delivery report from 019. Idempotent; unknown rows and unreadable fields are ignored
 * (the caller answers 200 either way so 019 keeps pushing).
 */
export async function handleDeliveryReport(fields: {
  externalId: unknown;
  status: unknown;
  date: unknown;
}): Promise<"updated" | "ignored"> {
  const id = typeof fields.externalId === "string" ? fields.externalId.trim() : "";
  const parsed = parseDlrStatus(fields.status);
  if (!/^[0-9a-fA-F-]{36}$/.test(id) || !parsed) return "ignored";

  const reportedAt = parseDlrDate(fields.date) ?? new Date();
  // The outcome decides whether this report marks the message as delivered.
  const next = applyDlr({ deliveryStatus: null, deliveredAt: null }, parsed, reportedAt);
  const updated = await recordSmsDelivery(id, next.deliveryStatus!, next.deliveredAt);
  return updated ? "updated" : "ignored";
}
