import { DASHBOARD_TZ } from "@/lib/superadmin/time";

/** Number with thousands separators. */
export function formatNumber(n: number): string {
  return new Intl.NumberFormat("he-IL").format(n);
}

/** Percent from a number that is already a percent (12.5 -> "12.5%"); "—" when there is nothing to show. */
export function formatPct(p: number | null): string {
  return p === null ? "—" : `${new Intl.NumberFormat("he-IL", { maximumFractionDigits: 1 }).format(p)}%`;
}

const ils = (digits: number) =>
  new Intl.NumberFormat("he-IL", { style: "currency", currency: "ILS", minimumFractionDigits: digits, maximumFractionDigits: digits });

/** A total in shekels, rounded to 2 decimals for display only (the value itself is never rounded). */
export function formatTotalIls(shekels: number): string {
  return ils(2).format(shekels);
}

/** A price per message in shekels, 3 decimals (₪0.009). */
export function formatPriceIls(shekels: number): string {
  return ils(3).format(shekels);
}

/** A date (and time) in Israel time. */
export function formatDateTime(iso: string, dateOnly = false): string {
  return new Intl.DateTimeFormat("he-IL", {
    timeZone: DASHBOARD_TZ,
    day: "2-digit",
    month: "2-digit",
    year: dateOnly ? "2-digit" : undefined,
    ...(dateOnly ? {} : { hour: "2-digit", minute: "2-digit", hour12: false }),
  }).format(new Date(iso));
}

/** Labels for the reasons a message was not sent. Unknown codes are shown as they are (they are codes, not data). */
export const REASON_LABELS: Record<string, string> = {
  business_disabled: "העסק כיבה את ההודעה",
  reminder_disabled: "העסק כיבה תזכורות",
  demo_business: "עסק דמו",
  phone_limit_hour: "מגבלת שעה לטלפון",
  phone_limit_day: "מגבלת יום לטלפון",
  site_url_missing: "חסרה כתובת האתר",
  sms_not_configured: "ה-SMS לא מוגדר",
  sms_source_invalid: "שם שולח לא תקין",
  appointment_cancelled: "התור בוטל",
  appointment_past: "התור כבר התחיל",
  appointment_moved: "התור הועבר",
  appointment_missing: "התור לא נמצא",
  phone_missing: "אין טלפון",
  phone_not_israeli: "טלפון לא ישראלי",
  phone_not_israeli_mobile: "לא טלפון נייד",
  unknown: "לא ידוע",
};

export const reasonLabel = (code: string) => REASON_LABELS[code] ?? code;
