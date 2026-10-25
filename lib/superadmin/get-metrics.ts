import { DatabaseNotConfiguredError, getBusinesses, getAppointments, getServices } from "@/lib/db";
import { isSupabaseConfigured, supabaseAdmin } from "@/lib/db/supabase";
import { memoryHeartbeats } from "@/lib/superadmin/heartbeat";
import { createMemorySource, type MemoryData } from "@/lib/superadmin/memory-source";
import {
  buildMetrics,
  type HealthRaw,
  type Heartbeat,
  type Metrics,
  type MetricsSource,
  type RollupRow,
  type SeriesRow,
  type Windows,
} from "@/lib/superadmin/metrics";
import { MANUAL_BOOKING_NOTE } from "@/lib/superadmin/config";
import { DEMO_BUSINESS_IDS, DEMO_BUSINESS_SLUGS } from "@/lib/demo";

/**
 * Where the dashboard numbers come from. One code path: the page and /api/superadmin/metrics both call getMetrics().
 * Production: the admin_* SQL functions through the service-role client (the database counts, no rows of
 * customers are read). Development without Supabase: the in-memory sample data.
 */

type Admin = NonNullable<typeof supabaseAdmin>;

export function supabaseMetricsSource(admin: Admin): MetricsSource {
  return {
    async rollup(w: Windows): Promise<RollupRow[]> {
      const { data, error } = await admin.rpc("admin_business_rollup", {
        p_today_start: w.todayStart,
        p_week_start: w.weekStart,
        p_month_start: w.monthStart,
        p_since_30d: w.since30,
        p_since_14d: w.since14,
        p_manual_note: MANUAL_BOOKING_NOTE,
      });
      if (error) throw error;
      return (data ?? []) as RollupRow[];
    },

    async smsSeries(fromIso: string): Promise<SeriesRow[]> {
      const { data, error } = await admin.rpc("admin_sms_series", {
        p_from: fromIso,
        p_demo_slugs: DEMO_BUSINESS_SLUGS,
        p_demo_ids: DEMO_BUSINESS_IDS,
      });
      if (error) throw error;
      return (data ?? []) as SeriesRow[];
    },

    async smsHealth(now: Date): Promise<HealthRaw> {
      const { data, error } = await admin.rpc("admin_sms_health", { p_now: now.toISOString() });
      if (error) throw error;
      const raw = (data ?? {}) as Partial<HealthRaw>;
      return { pending_overdue: Number(raw.pending_overdue ?? 0), failed_24h: raw.failed_24h ?? [] };
    },

    async heartbeat(job: string): Promise<Heartbeat | null> {
      const { data, error } = await admin.from("cron_heartbeat").select("job, last_run_at, ok, detail").eq("job", job).maybeSingle();
      // the table may not exist yet (migration not run): the card then says "never ran"
      if (error) return null;
      return (data as Heartbeat | null) ?? null;
    },
  };
}

/** Local development without Supabase: the in-memory sample businesses, appointments and SMS rows. */
async function loadMemoryData(): Promise<MemoryData> {
  const businesses = await getBusinesses();
  const data: MemoryData = { businesses: [], services: [], appointments: [], sms: [], heartbeats: memoryHeartbeats() };
  for (const b of businesses) {
    data.businesses.push({ id: b.id, slug: b.slug, name: b.name, created_at: b.created_at ?? new Date(0).toISOString() });
    for (const _service of await getServices(b.id)) data.services.push({ business_id: b.id });
    for (const a of await getAppointments(b.id)) {
      data.appointments.push({
        business_id: b.id,
        service_id: a.service_id || null,
        status: a.status,
        notes: a.notes ?? null,
        created_at: a.created_at ?? a.start_time,
      });
    }
  }
  const outbox = (globalThis as { __SMS_OUTBOX__?: Record<string, unknown>[] }).__SMS_OUTBOX__ ?? [];
  for (const o of outbox) {
    data.sms.push({
      business_id: (o.business_id as string | null) ?? null,
      kind: String(o.kind),
      status: String(o.status),
      last_error_code: (o.last_error_code as string | null) ?? null,
      segments: (o.segments as number | null) ?? null,
      billed_messages: (o.billed_messages as number | null) ?? null,
      delivered_at: (o.delivered_at as string | null) ?? null,
      created_at: String(o.created_at),
      next_attempt_at: String(o.next_attempt_at),
      updated_at: String(o.updated_at ?? o.created_at),
    });
  }
  return data;
}

export function metricsSource(): MetricsSource {
  if (isSupabaseConfigured && supabaseAdmin) return supabaseMetricsSource(supabaseAdmin);
  if (process.env.NODE_ENV === "production") throw new DatabaseNotConfiguredError();
  return {
    rollup: async (w) => createMemorySource(await loadMemoryData()).rollup(w),
    smsSeries: async (f) => createMemorySource(await loadMemoryData()).smsSeries(f),
    smsHealth: async (n) => createMemorySource(await loadMemoryData()).smsHealth(n),
    heartbeat: async (j) => createMemorySource(await loadMemoryData()).heartbeat(j),
  };
}

export function getMetrics(now: Date = new Date()): Promise<Metrics> {
  return buildMetrics(metricsSource(), { now, env: process.env });
}
