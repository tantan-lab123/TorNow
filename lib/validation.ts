import type { BusinessSettings, DateOverride, DayOfWeek, WorkingHours } from "@/lib/types";

const DAYS: DayOfWeek[] = [
  "sunday",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
];
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const SCHEME = /^\s*([a-z][a-z0-9+.-]*):/i;

/** Only http(s) links survive; javascript:, data:, vbscript: etc. are dropped. */
export function safeHttpUrl(v: unknown, max = 500): string | undefined {
  if (typeof v !== "string") return undefined;
  const s = v.trim();
  if (!s || s.length > max) return undefined;
  const m = s.match(SCHEME);
  if (m && !/^https?$/i.test(m[1])) return undefined;
  return s;
}

/** Image source: https URL or an inline raster image (never svg/html data URLs). */
export function safeImageSrc(v: unknown): string | undefined {
  if (typeof v !== "string") return undefined;
  const s = v.trim();
  if (!s) return undefined;
  if (/^data:image\/(png|jpe?g|webp|gif);base64,[a-z0-9+/=]+$/i.test(s) && s.length <= 2_000_000) return s;
  if (/^https:\/\//i.test(s) && s.length <= 500) return s;
  return undefined;
}

const str = (v: unknown, max: number) =>
  typeof v === "string" ? v.trim().slice(0, max) : undefined;
const num = (v: unknown, min: number, max: number) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : undefined;
};
const bool = (v: unknown) => (typeof v === "boolean" ? v : undefined);

export function sanitizeSettings(raw: unknown): BusinessSettings {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const out: BusinessSettings = {
    address: str(r.address, 300),
    whatsapp_phone: str(r.whatsapp_phone, 30),
    instagram_url: safeHttpUrl(r.instagram_url),
    tiktok_url: safeHttpUrl(r.tiktok_url),
    logo_url: safeImageSrc(r.logo_url),
    cover_image_url: safeImageSrc(r.cover_image_url),
    min_notice_hours: num(r.min_notice_hours, 0, 24 * 30),
    max_future_days: num(r.max_future_days, 1, 730),
    cancellation_cutoff_hours: num(r.cancellation_cutoff_hours, 0, 24 * 30),
    max_active_appointments_per_client: num(r.max_active_appointments_per_client, 0, 100),
    max_appointments_per_day: num(r.max_appointments_per_day, 0, 100),
    max_appointments_per_week: num(r.max_appointments_per_week, 0, 100),
    max_appointments_per_month: num(r.max_appointments_per_month, 0, 100),
    show_price_and_duration: bool(r.show_price_and_duration),
    require_staff_selection: bool(r.require_staff_selection),
    waiting_list_enabled: bool(r.waiting_list_enabled),
    show_hebrew_dates: bool(r.show_hebrew_dates),
    post_booking_message: str(r.post_booking_message, 1000),
    bit_payment_url: safeHttpUrl(r.bit_payment_url),
    paybox_payment_url: safeHttpUrl(r.paybox_payment_url),
  };
  // drop undefined keys
  return Object.fromEntries(Object.entries(out).filter(([, v]) => v !== undefined)) as BusinessSettings;
}

// The settings screen used to pre-fill these and save them without the owner typing them.
const LEGACY_PREFILLS: Partial<Record<keyof BusinessSettings, string>> = {
  address: "רוטשילד 15, תל אביב",
  post_booking_message: "נא להגיע 5 דקות לפני המועד שנקבע. חניה נוחה בכחול לבן ברחוב.",
};

/** Hide pre-filled sample values that were saved by accident, so customers never see them. */
export function dropLegacyPrefills(settings: BusinessSettings | undefined): BusinessSettings | undefined {
  if (!settings) return settings;
  const out = { ...settings };
  for (const [key, sample] of Object.entries(LEGACY_PREFILLS)) {
    const k = key as keyof BusinessSettings;
    if (typeof out[k] === "string" && (out[k] as string).trim() === sample) delete out[k];
  }
  return out;
}

export function sanitizeWorkingHours(raw: unknown): WorkingHours | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, any>;
  const out: Partial<WorkingHours> = {};
  for (const d of DAYS) {
    const day = r[d];
    if (!day || typeof day !== "object") return null;
    if (!HHMM.test(day.open) || !HHMM.test(day.close) || typeof day.active !== "boolean") return null;
    const entry: any = { open: day.open, close: day.close, active: day.active };
    const lb = day.lunch_break;
    if (lb && typeof lb === "object" && HHMM.test(lb.start) && HHMM.test(lb.end)) {
      entry.lunch_break = { active: lb.active === true, start: lb.start, end: lb.end };
    }
    out[d] = entry;
  }
  return out as WorkingHours;
}

export function sanitizeDateOverrides(raw: unknown): DateOverride[] | null {
  if (!Array.isArray(raw) || raw.length > 1000) return null;
  const out: DateOverride[] = [];
  for (const o of raw) {
    if (!o || typeof o !== "object" || !DATE.test((o as any).date)) return null;
    const x = o as Record<string, unknown>;
    out.push({
      id: String(x.id ?? x.date).slice(0, 64),
      date: x.date as string,
      is_closed: x.is_closed === true,
      reason: str(x.reason, 120) ?? "",
      ...(typeof x.custom_open === "string" && HHMM.test(x.custom_open) ? { custom_open: x.custom_open } : {}),
      ...(typeof x.custom_close === "string" && HHMM.test(x.custom_close) ? { custom_close: x.custom_close } : {}),
    });
  }
  return out;
}

/** Israeli mobile number from any common format (+972-50-..., 050 123 4567) -> "05XXXXXXXX", else null. */
export function normalizeIsraeliMobile(raw: unknown): string | null {
  if (typeof raw !== "string" && typeof raw !== "number") return null;
  let d = String(raw).replace(/[^0-9]/g, "");
  if (d.startsWith("00972")) d = d.slice(5);
  else if (d.startsWith("972")) d = d.slice(3);
  if (d.length === 9 && d.startsWith("5")) d = "0" + d;
  return /^05[0-9]{8}$/.test(d) ? d : null;
}
