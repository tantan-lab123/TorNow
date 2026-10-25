import { isDemoBusiness } from "@/lib/demo";
import type { HealthRaw, Heartbeat, MetricsSource, RollupRow, SeriesRow, Windows } from "@/lib/superadmin/metrics";
import { MANUAL_BOOKING_NOTE } from "@/lib/superadmin/config";
import { dayKey } from "@/lib/superadmin/time";

/**
 * The same counting as the SQL functions, over data held in memory. Used by the tests (as the fake database)
 * and by local development without Supabase. Keep it in step with the SQL in
 * supabase/migrations/20261026000001_superadmin_metrics.sql and 20261026000002_sms_billed_messages.sql.
 */

export interface MemoryData {
  businesses: { id: string; slug: string; name: string; created_at: string }[];
  services: { business_id: string }[];
  appointments: {
    business_id: string;
    /** null = blocked time */
    service_id: string | null;
    status: string;
    notes: string | null;
    created_at: string;
  }[];
  sms: {
    business_id: string | null;
    kind: string;
    status: string;
    last_error_code: string | null;
    segments: number | null;
    /** null on a sent row (an old one) counts 1, like the SQL */
    billed_messages?: number | null;
    delivered_at: string | null;
    created_at: string;
    next_attempt_at: string;
    updated_at: string;
  }[];
  heartbeats: Record<string, Heartbeat>;
}

const ms = (iso: string) => new Date(iso).getTime();

export function createMemorySource(data: MemoryData): MetricsSource {
  return {
    async rollup(w: Windows): Promise<RollupRow[]> {
      const today = ms(w.todayStart);
      const week = ms(w.weekStart);
      const month = ms(w.monthStart);
      const s30 = ms(w.since30);
      const s14 = ms(w.since14);
      return [...data.businesses]
        .sort((a, b) => ms(a.created_at) - ms(b.created_at))
        .map((b) => {
          const appts = data.appointments.filter((a) => a.business_id === b.id && a.service_id !== null);
          const at = (a: { created_at: string }) => ms(a.created_at);
          const isManual = (a: { notes: string | null }) => a.notes === MANUAL_BOOKING_NOTE;
          const sms30 = data.sms.filter((o) => o.business_id === b.id && ms(o.created_at) >= s30);
          const last = appts.length ? Math.max(...appts.map(at)) : null;
          return {
            business_id: b.id,
            slug: b.slug,
            name: b.name,
            business_created_at: b.created_at,
            services_count: data.services.filter((s) => s.business_id === b.id).length,
            appts_total: appts.length,
            appts_confirmed_30d: appts.filter((a) => a.status === "confirmed" && at(a) >= s30).length,
            appts_created_14d: appts.filter((a) => at(a) >= s14).length,
            appts_30d: appts.filter((a) => at(a) >= s30).length,
            appts_cancelled_30d: appts.filter((a) => at(a) >= s30 && a.status === "cancelled").length,
            last_appointment_at: last === null ? null : new Date(last).toISOString(),
            today_total: appts.filter((a) => at(a) >= today).length,
            today_manual: appts.filter((a) => at(a) >= today && isManual(a)).length,
            week_total: appts.filter((a) => at(a) >= week).length,
            week_manual: appts.filter((a) => at(a) >= week && isManual(a)).length,
            month_total: appts.filter((a) => at(a) >= month).length,
            month_manual: appts.filter((a) => at(a) >= month && isManual(a)).length,
            sms_sent_30d: sms30.filter((o) => o.status === "sent").length,
            sms_segments_30d: sms30.filter((o) => o.status === "sent").reduce((n, o) => n + (o.segments ?? 0), 0),
            sms_billed_30d: sms30.filter((o) => o.status === "sent").reduce((n, o) => n + (o.billed_messages ?? 1), 0),
            sms_failed_30d: sms30.filter((o) => o.status === "failed").length,
          };
        });
    },

    async smsSeries(fromIso: string): Promise<SeriesRow[]> {
      const from = ms(fromIso);
      const demoIds = new Set(data.businesses.filter((b) => isDemoBusiness({ id: b.id, slug: b.slug })).map((b) => b.id));
      const groups = new Map<string, SeriesRow>();
      for (const o of data.sms) {
        if (ms(o.created_at) < from) continue;
        if (o.business_id && demoIds.has(o.business_id)) continue;
        const reason = o.status === "skipped" || o.status === "failed" ? o.last_error_code : null;
        const local_day = dayKey(new Date(o.created_at));
        const key = [local_day, o.kind, o.status, reason ?? ""].join("|");
        const g = groups.get(key) ?? { local_day, kind: o.kind, status: o.status, reason, n: 0, segments: 0, billed: 0, delivered: 0 };
        g.n += 1;
        if (o.status === "sent") {
          g.segments += o.segments ?? 0;
          g.billed += o.billed_messages ?? 1;
          if (o.delivered_at) g.delivered += 1;
        }
        groups.set(key, g);
      }
      return [...groups.values()];
    },

    async smsHealth(now: Date): Promise<HealthRaw> {
      const overdue = now.getTime() - 15 * 60_000;
      const day = now.getTime() - 24 * 3_600_000;
      const failed = new Map<string, number>();
      for (const o of data.sms) {
        if (o.status === "failed" && ms(o.updated_at) >= day) {
          const code = o.last_error_code ?? "unknown";
          failed.set(code, (failed.get(code) ?? 0) + 1);
        }
      }
      return {
        pending_overdue: data.sms.filter((o) => o.status === "pending" && ms(o.next_attempt_at) < overdue).length,
        failed_24h: [...failed.entries()].map(([code, n]) => ({ code, n })).sort((a, b) => b.n - a.n),
      };
    },

    async heartbeat(job: string): Promise<Heartbeat | null> {
      return data.heartbeats[job] ?? null;
    },
  };
}
