import type { BusinessSettings } from "@/lib/types";
import type { SmsKind } from "@/lib/sms/outbox";

/**
 * The two questions asked before every customer SMS: "may we send it" and "with what wording".
 * They live here, in one place, so a later subscription or credit check has exactly one spot to join.
 * (No billing is built: today the only rule is the business's own on/off switch.)
 */

type WithSettings = { settings?: BusinessSettings } | null | undefined;

/** Reason written to the queue row when a business has switched the SMS off. */
export const SKIP_BUSINESS_DISABLED = "business_disabled";

/** A missing setting means "send": every existing business keeps getting confirmations. */
export function shouldSendSms(business: WithSettings, kind: SmsKind): boolean {
  void kind; // only the booking confirmation exists today; every kind answers to the same switch
  return business?.settings?.sms_confirmation_enabled !== false;
}

/**
 * The business's own wording for this kind of message, or undefined for the system default.
 * Not validated here: renderBookedMessage checks it again every time it is used.
 */
export function getSmsTemplate(business: WithSettings, kind: SmsKind): string | undefined {
  void kind;
  const t = business?.settings?.sms_confirmation_template;
  return typeof t === "string" && t.trim() !== "" ? t : undefined;
}
