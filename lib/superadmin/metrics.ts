import { isDemoBusiness } from "@/lib/demo";
import {
  HEARTBEAT_JOB_SMS,
  HEARTBEAT_STALE_MINUTES,
  MAX_TABLE_ROWS,
  SMS_ENV_VARS,
} from "@/lib/superadmin/config";
import {
  DASHBOARD_TZ,
  dayKey,
  israelDayStart,
  israelMonthStart,
  lastDayKeys,
  lastMonthKeys,
  monthKey,
} from "@/lib/superadmin/time";

/**
 * The numbers of the operator dashboard. The database counts (see the admin_* functions in
 * supabase/migrations/20261026000001_superadmin_metrics.sql); this file shapes the counts: it decides who is a
 * demo business, who is active, how the funnel and the charts look. It is pure (no database, no network), so
 * it is unit-tested with in-memory sources.
 *
 * PRIVACY: everything here is a count per business or per day. No customer, phone, e-mail, message text or token
 * ever reaches this layer (the SQL functions select none), and the output is checked for such keys by a test.
 */

// ------------------------------------------------------------------ what the database returns

export interface Windows {
  /** ISO instants (UTC) */
  todayStart: string;
  /** the start of the Israel day 6 days ago: "the last 7 days" including today */
  weekStart: string;
  monthStart: string;
  /** start of the Israel day 29 days ago: "the last 30 days" including today */
  since30: string;
  /** start of the Israel day 13 days ago: "the last 14 days" including today */
  since14: string;
}

export function windowsFor(now: Date): Windows {
  return {
    todayStart: israelDayStart(now, 0).toISOString(),
    weekStart: israelDayStart(now, -6).toISOString(),
    monthStart: israelMonthStart(now, 0).toISOString(),
    since30: israelDayStart(now, -29).toISOString(),
    since14: israelDayStart(now, -13).toISOString(),
  };
}

/** One row per business (admin_business_rollup). */
export interface RollupRow {
  business_id: string;
  slug: string;
  name: string;
  business_created_at: string;
  services_count: number;
  /** customer appointments ever (any status), by creation */
  appts_total: number;
  appts_confirmed_30d: number;
  appts_created_14d: number;
  appts_30d: number;
  appts_cancelled_30d: number;
  last_appointment_at: string | null;
  today_total: number;
  today_manual: number;
  week_total: number;
  week_manual: number;
  month_total: number;
  month_manual: number;
  sms_sent_30d: number;
  sms_segments_30d: number;
  /** messages billed for the sent ones (a sent row without a stored number counts 1) */
  sms_billed_30d: number;
  sms_failed_30d: number;
}

/** SMS counts per Israel day / kind / status / reason (admin_sms_series), demo businesses already left out. */
export interface SeriesRow {
  local_day: string; // YYYY-MM-DD
  kind: string;
  status: string;
  reason: string | null;
  n: number;
  /** carrier segments of the SENT messages in the group (technical) */
  segments: number;
  /** messages billed for the SENT messages in the group; 0 for other statuses */
  billed: number;
  /** sent messages in the group with a delivery report */
  delivered: number;
}

export interface HealthRaw {
  pending_overdue: number;
  failed_24h: { code: string; n: number }[];
}

export interface Heartbeat {
  job: string;
  last_run_at: string;
  ok: boolean;
  detail: string | null;
}

export interface MetricsSource {
  rollup(windows: Windows): Promise<RollupRow[]>;
  smsSeries(fromIso: string): Promise<SeriesRow[]>;
  smsHealth(now: Date): Promise<HealthRaw>;
  heartbeat(job: string): Promise<Heartbeat | null>;
}

// ------------------------------------------------------------------ what the dashboard shows

export interface Step {
  id: string;
  label: string;
  count: number;
  /** percent of the registered businesses; null when there are none */
  pctOfRegistered: number | null;
  /** percent of the step before; null when that step is empty */
  pctOfPrevious: number | null;
}

export interface PeriodCount {
  total: number;
  /** added by the business through its own form */
  manual: number;
  /** the rest: booked on the public page */
  public: number;
}

export interface SmsDay {
  day: string;
  booked: number;
  reminder: number;
  other: number;
  /** messages billed (the main number) */
  billed: number;
  /** carrier segments (secondary, technical) */
  segments: number;
}

export interface SmsMonth {
  month: string;
  booked: number;
  reminder: number;
  other: number;
  billed: number;
  segments: number;
  /** shekels (billed x price, not rounded), null when no price is configured */
  costIls: number | null;
}

export interface BusinessLine {
  name: string;
  slug: string;
  createdAt: string;
  isDemo: boolean;
  appts30d: number;
  smsSent30d: number;
  billed30d: number;
  segments30d: number;
  smsFailed30d: number;
  lastAppointmentAt: string | null;
}

export type Severity = "ok" | "warn" | "bad";

export interface Metrics {
  generatedAt: string;
  timezone: string;
  overview: {
    businesses: {
      total: number;
      new: { today: number; last7: number; last30: number };
      active: number;
      dormant: number;
      /** demo businesses left out of every number above and below */
      demoExcluded: number;
    };
    appointments: {
      today: PeriodCount;
      last7: PeriodCount;
      month: PeriodCount;
      created30d: number;
      cancelled30d: number;
      cancelledShare30d: number | null;
    };
  };
  funnel: { steps: Step[] };
  sms: {
    daily: SmsDay[];
    monthly: SmsMonth[];
    status30d: { sent: number; failed: number; skipped: number; pending: number };
    skipReasons30d: { reason: string; n: number }[];
    failedReasons30d: { reason: string; n: number }[];
    delivery30d: { sent: number; delivered: number; rate: number | null };
    billed: { last30d: number; thisMonth: number };
    segments: { last30d: number; thisMonth: number };
    cost: {
      priceConfigured: boolean;
      /** shekels per billed message */
      priceIls: number | null;
      /** shekels, not rounded: the screen rounds for display */
      last30dIls: number | null;
      thisMonthIls: number | null;
    };
  };
  businesses: { rows: BusinessLine[]; total: number; truncated: boolean };
  health: {
    cron: {
      job: string;
      status: "ok" | "stale" | "failing" | "never";
      severity: Severity;
      lastRunAt: string | null;
      minutesAgo: number | null;
      note: string | null;
    };
    pendingOverdue: number;
    failed24h: { code: string; n: number }[];
    /** which of the settings the SMS needs are set: names only, never values */
    env: { name: string; set: boolean }[];
    /** SMS_019_DRY_RUN: "on" only for the value 1 (the only value the sender honours); then nothing is really sent */
    dryRun: { set: boolean; on: boolean };
  };
  /** nothing is billed yet: no numbers */
  revenue: null;
}

// ------------------------------------------------------------------ helpers

/** Percent with one decimal; null when there is nothing to divide by. */
export function pct(part: number, whole: number): number | null {
  if (!(whole > 0)) return null;
  return Math.round((part / whole) * 1000) / 10;
}

/**
 * SMS_MESSAGE_PRICE_ILS: shekels per BILLED message, a decimal with a point (0.009). Number() of it must be
 * finite and above 0; anything else (unset, empty, "abc", "0", "-1", and "0,009" with a comma: not guessed) = not configured.
 */
export function parsePriceIls(raw: string | undefined | null): number | null {
  if (typeof raw !== "string") return null;
  const n = Number(raw.trim());
  return Number.isFinite(n) && n > 0 ? n : null;
}

const groupBy = <T,>(items: T[], key: (t: T) => string): Map<string, T[]> => {
  const m = new Map<string, T[]>();
  for (const it of items) {
    const k = key(it);
    const list = m.get(k);
    if (list) list.push(it);
    else m.set(k, [it]);
  }
  return m;
};

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

function ranked(map: Map<string, number>): { reason: string; n: number }[] {
  return [...map.entries()].map(([reason, n]) => ({ reason, n })).sort((a, b) => b.n - a.n || a.reason.localeCompare(b.reason));
}

// ------------------------------------------------------------------ the shaping

export interface BuildOptions {
  now: Date;
  /** process.env, or a fake: only the NAMES being set is read, never shown */
  env: Record<string, string | undefined>;
}

export async function buildMetrics(source: MetricsSource, { now, env }: BuildOptions): Promise<Metrics> {
  const windows = windowsFor(now);
  const seriesFrom = israelMonthStart(now, 5).toISOString(); // six months, this one included
  const [rollup, series, healthRaw, heartbeat] = await Promise.all([
    source.rollup(windows),
    source.smsSeries(seriesFrom),
    source.smsHealth(now),
    source.heartbeat(HEARTBEAT_JOB_SMS),
  ]);

  // ---- who counts: demo businesses are shown in the table and left out of every number
  const lines = rollup.map((r) => ({ r, isDemo: isDemoBusiness({ id: r.business_id, slug: r.slug }) }));
  const real = lines.filter((l) => !l.isDemo).map((l) => l.r);

  const t = (iso: string) => new Date(iso).getTime();
  const created = (r: RollupRow) => t(r.business_created_at);
  const fourteenDaysAgo = now.getTime() - 14 * 24 * 60 * 60 * 1000;

  const active = real.filter((r) => r.appts_confirmed_30d > 0).length;
  const dormant = real.filter((r) => created(r) < fourteenDaysAgo && r.appts_total === 0).length;

  const period = (total: (r: RollupRow) => number, manual: (r: RollupRow) => number): PeriodCount => {
    const tot = sum(real.map(total));
    const man = sum(real.map(manual));
    return { total: tot, manual: man, public: tot - man };
  };
  const created30d = sum(real.map((r) => r.appts_30d));
  const cancelled30d = sum(real.map((r) => r.appts_cancelled_30d));

  // ---- funnel
  const withService = real.filter((r) => r.services_count > 0).length;
  const withAppointment = real.filter((r) => r.appts_total > 0).length;
  const stillGetting = real.filter((r) => r.appts_created_14d > 0).length;
  const counts: [string, string, number][] = [
    ["registered", "נרשמו", real.length],
    ["service", "הגדירו שירות", withService],
    ["appointment", "קיבלו תור ראשון", withAppointment],
    ["recent", "מקבלים תורים ב-14 הימים האחרונים", stillGetting],
  ];
  const steps: Step[] = counts.map(([id, label, count], i) => ({
    id,
    label,
    count,
    pctOfRegistered: pct(count, real.length),
    pctOfPrevious: i === 0 ? null : pct(count, counts[i - 1][2]),
  }));

  // ---- SMS
  const dayKeys = lastDayKeys(now, 30);
  const monthKeys = lastMonthKeys(now, 6);
  const dayIndex = new Set(dayKeys);
  const price = parsePriceIls(env.SMS_MESSAGE_PRICE_ILS);
  const kindOf = (k: string): "booked" | "reminder" | "other" => (k === "booked" ? "booked" : k === "reminder" ? "reminder" : "other");

  const sentRows = series.filter((s) => s.status === "sent");
  const byDay = groupBy(sentRows, (s) => s.local_day);
  const daily: SmsDay[] = dayKeys.map((day) => {
    const rows = byDay.get(day) ?? [];
    const of = (kind: string) => sum(rows.filter((s) => kindOf(s.kind) === kind).map((s) => s.n));
    return {
      day,
      booked: of("booked"),
      reminder: of("reminder"),
      other: of("other"),
      billed: sum(rows.map((s) => s.billed)),
      segments: sum(rows.map((s) => s.segments)),
    };
  });
  const byMonth = groupBy(sentRows, (s) => s.local_day.slice(0, 7));
  const monthly: SmsMonth[] = monthKeys.map((month) => {
    const rows = byMonth.get(month) ?? [];
    const of = (kind: string) => sum(rows.filter((s) => kindOf(s.kind) === kind).map((s) => s.n));
    const billed = sum(rows.map((s) => s.billed));
    return {
      month,
      booked: of("booked"),
      reminder: of("reminder"),
      other: of("other"),
      billed,
      segments: sum(rows.map((s) => s.segments)),
      costIls: price === null ? null : billed * price,
    };
  });

  const last30 = series.filter((s) => dayIndex.has(s.local_day));
  const statusCount = (status: string) => sum(last30.filter((s) => s.status === status).map((s) => s.n));
  const reasonsOf = (status: string) => {
    const m = new Map<string, number>();
    for (const s of last30.filter((x) => x.status === status)) m.set(s.reason ?? "unknown", (m.get(s.reason ?? "unknown") ?? 0) + s.n);
    return ranked(m);
  };
  const sent30 = statusCount("sent");
  const delivered30 = sum(last30.filter((s) => s.status === "sent").map((s) => s.delivered));
  const segments30 = sum(last30.filter((s) => s.status === "sent").map((s) => s.segments));
  const billed30 = sum(last30.filter((s) => s.status === "sent").map((s) => s.billed));
  const thisMonth = monthly[monthly.length - 1];

  // ---- the table
  const tableAll: BusinessLine[] = lines
    .map(({ r, isDemo }) => ({
      name: r.name,
      slug: r.slug,
      createdAt: r.business_created_at,
      isDemo,
      appts30d: r.appts_30d,
      smsSent30d: r.sms_sent_30d,
      billed30d: r.sms_billed_30d,
      segments30d: r.sms_segments_30d,
      smsFailed30d: r.sms_failed_30d,
      lastAppointmentAt: r.last_appointment_at,
    }))
    .sort((a, b) => b.appts30d - a.appts30d || b.billed30d - a.billed30d || a.name.localeCompare(b.name, "he"));

  // ---- health
  const minutesAgo = heartbeat ? Math.max(0, Math.floor((now.getTime() - t(heartbeat.last_run_at)) / 60_000)) : null;
  let cronStatus: Metrics["health"]["cron"]["status"] = "ok";
  let severity: Severity = "ok";
  let note: string | null = null;
  if (!heartbeat) {
    cronStatus = "never";
    severity = "bad";
    note = "לא תועדה אף ריצה";
  } else if ((minutesAgo ?? 0) > HEARTBEAT_STALE_MINUTES) {
    cronStatus = "stale";
    severity = "bad";
    note = "לא רצה ב-15 הדקות האחרונות";
  } else if (!heartbeat.ok) {
    cronStatus = "failing";
    severity = "bad";
    note = "הריצה האחרונה דיווחה על תקלה";
  }

  return {
    generatedAt: now.toISOString(),
    timezone: DASHBOARD_TZ,
    overview: {
      businesses: {
        total: real.length,
        new: {
          today: real.filter((r) => created(r) >= t(windows.todayStart)).length,
          last7: real.filter((r) => created(r) >= t(windows.weekStart)).length,
          last30: real.filter((r) => created(r) >= t(windows.since30)).length,
        },
        active,
        dormant,
        demoExcluded: lines.length - real.length,
      },
      appointments: {
        today: period((r) => r.today_total, (r) => r.today_manual),
        last7: period((r) => r.week_total, (r) => r.week_manual),
        month: period((r) => r.month_total, (r) => r.month_manual),
        created30d,
        cancelled30d,
        cancelledShare30d: pct(cancelled30d, created30d),
      },
    },
    funnel: { steps },
    sms: {
      daily,
      monthly,
      status30d: { sent: sent30, failed: statusCount("failed"), skipped: statusCount("skipped"), pending: statusCount("pending") },
      skipReasons30d: reasonsOf("skipped"),
      failedReasons30d: reasonsOf("failed"),
      delivery30d: { sent: sent30, delivered: delivered30, rate: pct(delivered30, sent30) },
      billed: { last30d: billed30, thisMonth: thisMonth?.billed ?? 0 },
      segments: { last30d: segments30, thisMonth: thisMonth?.segments ?? 0 },
      cost: {
        priceConfigured: price !== null,
        priceIls: price,
        last30dIls: price === null ? null : billed30 * price,
        thisMonthIls: price === null ? null : (thisMonth?.billed ?? 0) * price,
      },
    },
    businesses: { rows: tableAll.slice(0, MAX_TABLE_ROWS), total: tableAll.length, truncated: tableAll.length > MAX_TABLE_ROWS },
    health: {
      cron: {
        job: HEARTBEAT_JOB_SMS,
        status: cronStatus,
        severity,
        lastRunAt: heartbeat?.last_run_at ?? null,
        minutesAgo,
        note,
      },
      pendingOverdue: healthRaw.pending_overdue,
      failed24h: [...healthRaw.failed_24h].sort((a, b) => b.n - a.n),
      env: SMS_ENV_VARS.map((name) => ({ name, set: typeof env[name] === "string" && env[name]!.trim() !== "" })),
      dryRun: { set: typeof env.SMS_019_DRY_RUN === "string" && env.SMS_019_DRY_RUN.trim() !== "", on: env.SMS_019_DRY_RUN === "1" },
    },
    revenue: null,
  };
}

// re-exported for the day/month helpers the tests use together with the shaping
export { dayKey, monthKey };
