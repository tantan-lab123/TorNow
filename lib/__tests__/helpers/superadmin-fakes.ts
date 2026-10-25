import type { MemoryData } from "@/lib/superadmin/memory-source";
import { MANUAL_BOOKING_NOTE } from "@/lib/superadmin/config";

/** In-memory data for the dashboard tests (example names only). */

export const NOW = new Date("2026-11-05T10:00:00Z"); // Thursday 12:00 in Israel (winter time)
export const DAY = 24 * 60 * 60 * 1000;
export const ago = (ms: number, now: Date = NOW) => new Date(now.getTime() - ms).toISOString();

export const ENV_ALL = {
  SMS_019_API_TOKEN: "secret-token-value",
  SMS_019_USERNAME: "secret-user-value",
  SMS_019_SOURCE: "TorNow",
  SMS_019_WEBHOOK_SECRET: "secret-hook-value",
  NEXT_PUBLIC_SITE_URL: "https://tornow.example",
  CRON_SECRET: "secret-cron-value-0123456789",
};

export function emptyData(): MemoryData {
  return { businesses: [], services: [], appointments: [], sms: [], heartbeats: {} };
}

export function addBusiness(
  data: MemoryData,
  id: string,
  over: { slug?: string; name?: string; created?: string; services?: number } = {}
) {
  data.businesses.push({
    id,
    slug: over.slug ?? `biz-${id}`,
    name: over.name ?? `עסק ${id}`,
    created_at: over.created ?? ago(40 * DAY),
  });
  for (let i = 0; i < (over.services ?? 1); i++) data.services.push({ business_id: id });
}

export function addAppointment(
  data: MemoryData,
  businessId: string,
  over: { created?: string; status?: string; manual?: boolean; blocked?: boolean } = {}
) {
  data.appointments.push({
    business_id: businessId,
    service_id: over.blocked ? null : "svc",
    status: over.status ?? "confirmed",
    notes: over.manual ? MANUAL_BOOKING_NOTE : null,
    created_at: over.created ?? ago(1 * DAY),
  });
}

export function addSms(
  data: MemoryData,
  businessId: string | null,
  over: {
    kind?: string;
    status?: string;
    reason?: string | null;
    segments?: number | null;
    delivered?: boolean;
    created?: string;
    nextAttempt?: string;
    updated?: string;
  } = {}
) {
  const created = over.created ?? ago(1 * DAY);
  data.sms.push({
    business_id: businessId,
    kind: over.kind ?? "booked",
    status: over.status ?? "sent",
    last_error_code: over.reason ?? null,
    segments: over.segments === undefined ? 2 : over.segments,
    delivered_at: over.delivered ? created : null,
    created_at: created,
    next_attempt_at: over.nextAttempt ?? created,
    updated_at: over.updated ?? created,
  });
}
