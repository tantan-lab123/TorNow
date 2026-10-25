import React from "react";
import type { Metrics, PeriodCount, SmsDay, SmsMonth } from "@/lib/superadmin/metrics";
import { BusinessTable } from "@/components/superadmin/BusinessTable";
import { LogoutButton, RefreshButton } from "@/components/superadmin/Controls";
import { formatDateTime, formatNumber, formatPct, formatPriceIls, formatTotalIls, reasonLabel } from "@/components/superadmin/format";
import { cn } from "@/lib/utils";

const card = "rounded-xl border border-ink-200 bg-white p-5";
const h2 = "text-[22px] font-extrabold leading-tight sm:text-[26px]";

function Section({ id, title, children }: { id: string; title: string; children: React.ReactNode }) {
  return (
    <section aria-labelledby={id} className="mt-10">
      <h2 id={id} className={h2}>
        {title}
      </h2>
      <div className="mt-4">{children}</div>
    </section>
  );
}

function Stat({ label, value, hint }: { label: string; value: React.ReactNode; hint?: React.ReactNode }) {
  return (
    <div className={card}>
      <p className="text-[14px] font-semibold text-ink-700">{label}</p>
      <p className="mt-1 text-[32px] font-extrabold leading-none tabular-nums">{value}</p>
      {hint && <p className="mt-2 text-[13px] leading-snug text-ink-700">{hint}</p>}
    </div>
  );
}

const period = (p: PeriodCount) => (
  <>
    {formatNumber(p.public)} מהעמוד הציבורי · {formatNumber(p.manual)} שהעסק הוסיף
  </>
);

// ------------------------------------------------------------------ charts (inline SVG, with a table as the text alternative)

interface Bar {
  label: string;
  booked: number;
  reminder: number;
  other: number;
  /** messages billed that day / month */
  billed: number;
  /** carrier segments (technical) */
  segments: number;
}

function StackedBars({ title, bars, unit }: { title: string; bars: Bar[]; unit: string }) {
  const W = 600;
  const H = 160;
  const step = W / bars.length;
  const bw = Math.max(2, step * 0.7);
  const max = Math.max(1, ...bars.map((b) => b.booked + b.reminder + b.other));
  const total = bars.reduce((n, b) => n + b.booked + b.reminder + b.other, 0);
  const totalBilled = bars.reduce((n, b) => n + b.billed, 0);
  return (
    <figure className={card}>
      <figcaption className="text-[16px] font-bold">{title}</figcaption>
      <svg
        viewBox={`0 0 ${W} ${H + 4}`}
        role="img"
        aria-label={`${title}: ${formatNumber(total)} ${unit} בסך הכול, ${formatNumber(totalBilled)} הודעות לחיוב`}
        className="mt-3 h-auto w-full"
        preserveAspectRatio="none"
      >
        {bars.map((b, i) => {
          // newest on the left: the axis runs the way Hebrew is read
          const x = (bars.length - 1 - i) * step + (step - bw) / 2;
          const hb = (b.booked / max) * H;
          const hr = (b.reminder / max) * H;
          const ho = (b.other / max) * H;
          return (
            <g key={b.label}>
              <rect x={x} y={H - hb} width={bw} height={hb} className="fill-brand-600" />
              <rect x={x} y={H - hb - hr} width={bw} height={hr} className="fill-lime-edge" />
              <rect x={x} y={H - hb - hr - ho} width={bw} height={ho} className="fill-ink-400" />
            </g>
          );
        })}
        <line x1="0" y1={H + 1} x2={W} y2={H + 1} className="stroke-ink-200" strokeWidth="1" />
      </svg>
      <p className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[13px] text-ink-700">
        <Legend color="bg-brand-600" label="אישורים" />
        <Legend color="bg-lime-edge" label="תזכורות" />
        <Legend color="bg-ink-400" label="אחר" />
      </p>
      <details className="mt-3">
        <summary className="flex min-h-11 cursor-pointer items-center text-[14px] font-bold text-brand-700">הצגה כטבלה</summary>
        <div className="relative max-h-72 overflow-auto">
          <table className="w-full border-collapse text-right text-[13px]">
            <caption className="sr-only">{title}</caption>
            <thead>
              <tr className="border-b border-ink-200">
                <th scope="col" className="py-1.5 pl-3 font-bold">תאריך</th>
                <th scope="col" className="py-1.5 pl-3 font-bold">אישורים</th>
                <th scope="col" className="py-1.5 pl-3 font-bold">תזכורות</th>
                <th scope="col" className="py-1.5 pl-3 font-bold">אחר</th>
                <th scope="col" className="py-1.5 pl-3 font-bold">הודעות לחיוב</th>
                <th scope="col" className="py-1.5 pl-3 font-normal text-ink-600">מקטעים</th>
              </tr>
            </thead>
            <tbody>
              {[...bars].reverse().map((b) => (
                <tr key={b.label} className="border-b border-ink-100">
                  <th scope="row" className="py-1.5 pl-3 font-semibold tabular-nums" dir="ltr" style={{ textAlign: "right" }}>
                    {b.label}
                  </th>
                  <td className="py-1.5 pl-3 tabular-nums">{b.booked}</td>
                  <td className="py-1.5 pl-3 tabular-nums">{b.reminder}</td>
                  <td className="py-1.5 pl-3 tabular-nums">{b.other}</td>
                  <td className="py-1.5 pl-3 font-bold tabular-nums">{b.billed}</td>
                  <td className="py-1.5 pl-3 tabular-nums text-ink-600">{b.segments}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </figure>
  );
}

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span aria-hidden="true" className={cn("inline-block h-3 w-3 rounded-sm", color)} />
      {label}
    </span>
  );
}

const dayBars = (days: SmsDay[]): Bar[] =>
  days.map((d) => ({ label: d.day, booked: d.booked, reminder: d.reminder, other: d.other, billed: d.billed, segments: d.segments }));
const monthBars = (months: SmsMonth[]): Bar[] =>
  months.map((m) => ({ label: m.month, booked: m.booked, reminder: m.reminder, other: m.other, billed: m.billed, segments: m.segments }));

// ------------------------------------------------------------------ the page

export function Dashboard({ metrics }: { metrics: Metrics }) {
  const { overview, funnel, sms, health } = metrics;
  const b = overview.businesses;
  const a = overview.appointments;

  return (
    <main className="mx-auto max-w-6xl px-5 pb-20 pt-6 sm:px-8">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-[28px] font-extrabold leading-tight sm:text-[34px]">לוח בקרה</h1>
          <p className="mt-1 text-[14px] text-ink-700">
            עודכן ב-<time dateTime={metrics.generatedAt}>{formatDateTime(metrics.generatedAt)}</time> (שעון ישראל). עסקי הדמו אינם נספרים.
          </p>
        </div>
        <div className="flex gap-2">
          <RefreshButton />
          <LogoutButton />
        </div>
      </header>

      <Section id="overview" title="סיכום">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Stat
            label="עסקים רשומים"
            value={formatNumber(b.total)}
            hint={`חדשים: ${formatNumber(b.new.today)} היום · ${formatNumber(b.new.last7)} ב-7 ימים · ${formatNumber(b.new.last30)} ב-30 יום`}
          />
          <Stat label="עסקים פעילים" value={formatNumber(b.active)} hint="לפחות תור מאושר אחד שנוצר ב-30 הימים האחרונים" />
          <Stat label="עסקים רדומים" value={formatNumber(b.dormant)} hint="נרשמו לפני יותר מ-14 יום ועדיין בלי אף תור" />
          <Stat
            label="תורים שנוצרו היום"
            value={formatNumber(a.today.total)}
            hint={period(a.today)}
          />
          <Stat label="תורים ב-7 הימים האחרונים" value={formatNumber(a.last7.total)} hint={period(a.last7)} />
          <Stat label="תורים החודש" value={formatNumber(a.month.total)} hint={period(a.month)} />
          <Stat
            label="שיעור ביטולים (30 יום)"
            value={formatPct(a.cancelledShare30d)}
            hint={`${formatNumber(a.cancelled30d)} מתוך ${formatNumber(a.created30d)} תורים שנוצרו`}
          />
          <div className={cn(card, "border-dashed bg-ink-50")} aria-label="הכנסות ומנויים - בקרוב">
            <p className="text-[14px] font-semibold text-ink-700">הכנסות ומנויים</p>
            <p className="mt-1 text-[22px] font-extrabold text-ink-600">בקרוב</p>
            <p className="mt-2 text-[13px] text-ink-700">עדיין לא מחייבים, ולכן אין מה להציג.</p>
          </div>
        </div>
        <p className="mt-3 text-[13px] leading-relaxed text-ink-700">
          ספירת התורים היא לפי מועד היצירה שלהם. תור שהעסק הוסיף בעצמו מזוהה לפי ההערה שהטופס שלו רושם, ולכן זה קירוב. תורי חסימת זמן, ותורים של
          שירות שנמחק, לא נספרים.
        </p>
      </Section>

      <Section id="funnel" title="משפך">
        <ol className={cn(card, "space-y-4")}>
          {funnel.steps.map((s, i) => (
            <li key={s.id}>
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="text-[15px] font-bold">
                  {i + 1}. {s.label}
                </span>
                <span className="text-[14px] tabular-nums text-ink-700">
                  <strong className="text-[18px] text-ink-900">{formatNumber(s.count)}</strong> · {formatPct(s.pctOfRegistered)} מהנרשמים
                  {i > 0 && <> · {formatPct(s.pctOfPrevious)} מהשלב הקודם</>}
                </span>
              </div>
              <div className="mt-2 h-3 overflow-hidden rounded-full bg-ink-100" role="presentation">
                <div className="h-full rounded-full bg-brand-600" style={{ width: `${Math.min(100, s.pctOfRegistered ?? 0)}%` }} />
              </div>
            </li>
          ))}
        </ol>
      </Section>

      <Section id="sms" title="SMS">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Stat label="נשלחו (30 יום)" value={formatNumber(sms.status30d.sent)} hint={`מתוכם הגיעו ליעד: ${formatPct(sms.delivery30d.rate)}`} />
          <Stat
            label="הודעות לחיוב (30 יום)"
            value={formatNumber(sms.billed.last30d)}
            hint={
              <>
                החודש: {formatNumber(sms.billed.thisMonth)}
                <span className="block text-ink-600">מקטעים: {formatNumber(sms.segments.last30d)} (החודש: {formatNumber(sms.segments.thisMonth)})</span>
              </>
            }
          />
          <Stat
            label="עלות משוערת (30 יום)"
            value={sms.cost.last30dIls === null ? "—" : formatTotalIls(sms.cost.last30dIls)}
            hint={
              sms.cost.priceConfigured
                ? `החודש: ${formatTotalIls(sms.cost.thisMonthIls ?? 0)} (הודעות לחיוב × ${formatPriceIls(sms.cost.priceIls ?? 0)})`
                : "מחיר להודעה לא הוגדר"
            }
          />
          <Stat
            label="נכשלו / דולגו / ממתינות"
            value={`${formatNumber(sms.status30d.failed)} / ${formatNumber(sms.status30d.skipped)} / ${formatNumber(sms.status30d.pending)}`}
            hint="30 הימים האחרונים"
          />
        </div>
        <div className="mt-4 grid gap-4 lg:grid-cols-2">
          <StackedBars title="הודעות שנשלחו, לפי יום (30 יום)" bars={dayBars(sms.daily)} unit="הודעות" />
          <StackedBars title="הודעות שנשלחו, לפי חודש (6 חודשים)" bars={monthBars(sms.monthly)} unit="הודעות" />
        </div>
        <div className="mt-4 grid gap-4 lg:grid-cols-2">
          <ReasonList title="למה לא נשלחו (דולגו, 30 יום)" items={sms.skipReasons30d} />
          <ReasonList title="למה נכשלו (30 יום)" items={sms.failedReasons30d} />
        </div>
        {!sms.cost.priceConfigured && (
          <p className="mt-3 text-[13px] text-ink-700">מחיר להודעה לא הוגדר: מוצגת ספירה בלבד. אפשר להגדיר SMS_MESSAGE_PRICE_ILS (שקלים להודעה לחיוב, למשל 0.009).</p>
        )}
        {sms.monthly.some((m) => m.costIls !== null) && (
          <div className="mt-3 text-[13px] text-ink-700">
            <p className="font-semibold">עלות משוערת לפי חודש:</p>
            <ul className="mt-1 flex flex-wrap gap-x-5 gap-y-1">
              {sms.monthly.map((m) => (
                <li key={m.month} dir="ltr" className="tabular-nums">
                  {m.month}: {m.costIls === null ? "—" : formatTotalIls(m.costIls)}
                </li>
              ))}
            </ul>
          </div>
        )}
      </Section>

      <Section id="businesses" title="עסקים לפי שימוש">
        <BusinessTable rows={metrics.businesses.rows} />
        {metrics.businesses.truncated && (
          <p className="mt-2 text-[13px] text-ink-700">מוצגים {formatNumber(metrics.businesses.rows.length)} מתוך {formatNumber(metrics.businesses.total)} העסקים.</p>
        )}
      </Section>

      <Section id="health" title="בריאות המערכת">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className={cn(card, health.cron.severity === "ok" ? "border-brand-600" : "border-danger-500 border-2")}>
            <p className="text-[14px] font-semibold text-ink-700">תהליך שליחת ההודעות (cron)</p>
            <p className={cn("mt-1 text-[22px] font-extrabold", health.cron.severity === "ok" ? "text-brand-700" : "text-danger-700")}>
              {health.cron.severity === "ok" ? "תקין" : "תקלה"}
            </p>
            <p className="mt-1 text-[14px] text-ink-700">
              {health.cron.lastRunAt
                ? `ריצה אחרונה: ${formatDateTime(health.cron.lastRunAt)} (לפני ${formatNumber(health.cron.minutesAgo ?? 0)} דקות)`
                : "לא תועדה אף ריצה"}
              {health.cron.note && <> · {health.cron.note}</>}
            </p>
          </div>
          <div className={cn(card, health.pendingOverdue > 0 && "border-danger-500 border-2")}>
            <p className="text-[14px] font-semibold text-ink-700">הודעות ממתינות שעבר זמנן (יותר מ-15 דקות)</p>
            <p className="mt-1 text-[32px] font-extrabold tabular-nums">{formatNumber(health.pendingOverdue)}</p>
          </div>
          <ReasonList
            title="נכשלו ב-24 השעות האחרונות, לפי קוד"
            items={health.failed24h.map((f) => ({ reason: f.code, n: f.n }))}
            raw
          />
          <div className={card}>
            <p className="text-[16px] font-bold">הגדרות ה-SMS בשרת (שמות בלבד)</p>
            {health.dryRun.on && (
              <p role="alert" className="mt-2 rounded-lg border-2 border-danger-500 bg-danger-50 p-3 text-[14px] font-bold text-danger-800">
                SMS_019_DRY_RUN פעיל: שום הודעה לא נשלחת באמת.
              </p>
            )}
            {!health.dryRun.on && health.dryRun.set && (
              <p className="mt-2 text-[13px] text-ink-700">SMS_019_DRY_RUN מוגדר, אבל רק הערך 1 מפעיל אותו.</p>
            )}
            <ul className="mt-3 space-y-1.5 text-[14px]">
              {health.env.map((e) => (
                <li key={e.name} className="flex items-center justify-between gap-3">
                  <span dir="ltr" className="font-mono text-[13px]">{e.name}</span>
                  <span className={cn("font-bold", e.set ? "text-brand-700" : "text-danger-700")}>{e.set ? "מוגדר" : "חסר"}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </Section>
    </main>
  );
}

function ReasonList({ title, items, raw }: { title: string; items: { reason: string; n: number }[]; raw?: boolean }) {
  return (
    <div className={card}>
      <p className="text-[16px] font-bold">{title}</p>
      {items.length === 0 ? (
        <p className="mt-2 text-[14px] text-ink-700">אין.</p>
      ) : (
        <table className="mt-2 w-full border-collapse text-right text-[14px]">
          <caption className="sr-only">{title}</caption>
          <tbody>
            {items.map((i) => (
              <tr key={i.reason} className="border-b border-ink-100 last:border-b-0">
                <th scope="row" className="py-2 pl-3 font-semibold">
                  {raw ? <span dir="ltr" className="font-mono text-[13px]">{i.reason}</span> : reasonLabel(i.reason)}
                  {!raw && <span dir="ltr" className="mr-2 font-mono text-[12px] font-normal text-ink-600">{i.reason}</span>}
                </th>
                <td className="py-2 tabular-nums">{formatNumber(i.n)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
