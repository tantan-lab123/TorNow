import type { BusinessSettings } from "@/lib/types";
import type { SmsKind } from "@/lib/sms/outbox";
import { isDemoBusiness } from "@/lib/demo";
import { normalizeReminderMinutes } from "@/lib/sms/message";

/**
 * The two questions asked before every customer SMS: "may we send it" and "with what wording".
 * They live here, in one place, so a later subscription or credit check has exactly one spot to join.
 * (No billing is built: the rules are the demo ban and the business's own switches.)
 */

/** What the rules need to know about a business. */
type BusinessLike = { id?: string; slug?: string; settings?: BusinessSettings } | null | undefined;

/** Reasons written to the queue row. */
export const SKIP_BUSINESS_DISABLED = "business_disabled";
export const SKIP_DEMO_BUSINESS = "demo_business";
export const SKIP_REMINDER_DISABLED = "reminder_disabled";

/** Minutes before the appointment the owner chose for the reminder; 0 (never) when missing or invalid. */
export function reminderMinutes(business: BusinessLike): number {
  return normalizeReminderMinutes(business?.settings?.sms_reminder_minutes);
}

/**
 * Why this business must not send this kind of message right now, or null when it may.
 * The demo businesses never send anything: that wins over every switch of the owner.
 */
export function smsBlockReason(business: BusinessLike, kind: SmsKind): string | null {
  if (isDemoBusiness(business)) return SKIP_DEMO_BUSINESS;
  if (kind === "reminder") {
    return reminderMinutes(business) > 0 ? null : SKIP_REMINDER_DISABLED;
  }
  // The confirmation: a missing setting means "send", every existing business keeps getting it.
  // (The other kinds do not exist yet and answer to the same switch.)
  return business?.settings?.sms_confirmation_enabled === false ? SKIP_BUSINESS_DISABLED : null;
}

export function shouldSendSms(business: BusinessLike, kind: SmsKind): boolean {
  return smsBlockReason(business, kind) === null;
}

/**
 * The business's own wording for this kind of message, or undefined for the system default.
 * Not validated here: the renderer checks it again every time it is used.
 */
export function getSmsTemplate(business: BusinessLike, kind: SmsKind): string | undefined {
  const t =
    kind === "reminder" ? business?.settings?.sms_reminder_template : business?.settings?.sms_confirmation_template;
  return typeof t === "string" && t.trim() !== "" ? t : undefined;
}
