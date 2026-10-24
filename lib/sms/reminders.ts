import { TZDate } from "@date-fns/tz";
import { isPlaceholderPhone } from "@/lib/client-search";
import { isDemoBusiness } from "@/lib/demo";
import { normalizeIsraeliMobile } from "@/lib/sms/019";
import { enqueueSms, type SmsEnv, type SmsRepo } from "@/lib/sms/outbox";

/**
 * Reminder SMS before an appointment.
 *
 * Nothing is queued when an appointment is booked. The cron job runs the planner below, which looks
 * at every business that asked for reminders and queues the ones that have become due: so changing
 * the setting also applies to appointments that already exist, and a moved appointment simply gets
 * a new reminder for its new time.
 */

const TZ = "Asia/Jerusalem";

/** A reminder that is more than this late is not sent any more (the cron job was down, ...). */
export const REMINDER_GRACE_MS = 30 * 60_000;
/** No reminder for an appointment that starts in less than this. */
export const REMINDER_MIN_LEAD_MS = 5 * 60_000;
/** At most this many reminders are queued per run. */
export const REMINDER_PLAN_CAP = 200;
/** "The day before" never goes out before 08:00 or after 21:00 Israel time. */
export const QUIET_START_MINUTES = 8 * 60;
export const QUIET_END_MINUTES = 21 * 60;
const DAY_BEFORE = 1440;

/**
 * When the reminder for an appointment is due. N minutes before the start, except "a day before":
 * the same wall-clock time on the previous day in Israel, moved into 08:00-21:00 of that day.
 * null when the business has no reminders (0).
 */
export function reminderSendAt(startIso: string | Date, minutes: number): Date | null {
  if (!(minutes > 0)) return null;
  const start = new Date(startIso);
  if (Number.isNaN(start.getTime())) return null;
  if (minutes !== DAY_BEFORE) return new Date(start.getTime() - minutes * 60_000);

  const local = new TZDate(start.getTime(), TZ);
  // same wall-clock time on the previous calendar day (right across the summer-time switch too)
  const prev = new TZDate(local.getFullYear(), local.getMonth(), local.getDate() - 1, local.getHours(), local.getMinutes(), 0, 0, TZ);
  const at = prev.getHours() * 60 + prev.getMinutes();
  const clamped = Math.min(Math.max(at, QUIET_START_MINUTES), QUIET_END_MINUTES);
  const send = new TZDate(prev.getFullYear(), prev.getMonth(), prev.getDate(), Math.floor(clamped / 60), clamped % 60, 0, 0, TZ);
  return new Date(send.getTime());
}

export interface ReminderCandidate {
  id: string;
  business_id: string;
  start_time: string;
  /** When the appointment was booked. */
  created_at: string;
  phone: string | null;
}

export interface ReminderBusiness {
  id: string;
  slug?: string;
  /** sms_reminder_minutes from the business settings (0 = never) */
  minutes: number;
}

export interface ReminderRepo {
  /** Businesses that may want reminders (the planner ignores the ones with 0 minutes). */
  listReminderBusinesses(): Promise<ReminderBusiness[]>;
  /** Confirmed customer appointments of these businesses that start in the given range. */
  listReminderCandidates(input: {
    businessIds: string[];
    startAfterIso: string;
    startBeforeIso: string;
    limit: number;
  }): Promise<ReminderCandidate[]>;
  /** Keys (reminderKey) of the reminder rows that already exist for these appointments. */
  existingReminderKeys(appointmentIds: string[]): Promise<Set<string>>;
}

export function reminderKey(appointmentId: string, startIso: string | Date): string {
  return `${appointmentId}|${new Date(startIso).getTime()}`;
}

export type ReminderVerdict = "due" | "not_yet" | "too_late" | "too_close" | "booked_after_send_time";

/** Is this appointment's reminder due right now? */
export function reminderVerdict(
  appt: { start_time: string; created_at: string },
  minutes: number,
  now: Date
): ReminderVerdict {
  const sendAt = reminderSendAt(appt.start_time, minutes);
  if (!sendAt) return "not_yet";
  const start = new Date(appt.start_time).getTime();
  if (start <= now.getTime() + REMINDER_MIN_LEAD_MS) return "too_close";
  if (sendAt.getTime() > now.getTime()) return "not_yet";
  if (now.getTime() - sendAt.getTime() > REMINDER_GRACE_MS) return "too_late";
  // Booked after the reminder time: the confirmation sent at booking already covers it.
  if (new Date(appt.created_at).getTime() >= sendAt.getTime()) return "booked_after_send_time";
  return "due";
}

export interface PlanResult {
  businesses: number;
  considered: number;
  planned: number;
  alreadyPlanned: number;
  /** due, but nothing was queued for it: no usable phone */
  noPhone: number;
}

/**
 * Queues the reminders that are due. Idempotent: running it twice (or from two instances) queues
 * every reminder once. Demo businesses are never looked at: no rows at all.
 */
export async function planDueReminders(
  deps: { reminders: ReminderRepo; sms: SmsRepo },
  opts: { cap?: number } = {},
  ctx: SmsEnv = {}
): Promise<PlanResult> {
  const now = (ctx.now ?? (() => new Date()))();
  const cap = opts.cap ?? REMINDER_PLAN_CAP;
  const result: PlanResult = { businesses: 0, considered: 0, planned: 0, alreadyPlanned: 0, noPhone: 0 };

  const businesses = (await deps.reminders.listReminderBusinesses()).filter(
    (b) => b.minutes > 0 && !isDemoBusiness(b)
  );
  result.businesses = businesses.length;
  if (businesses.length === 0) return result;
  const byId = new Map(businesses.map((b) => [b.id, b]));

  // The longest look-ahead is "a day before" (up to 21h after / 3h before the plain 24h, plus slack).
  const candidates = await deps.reminders.listReminderCandidates({
    businessIds: businesses.map((b) => b.id),
    startAfterIso: new Date(now.getTime() + REMINDER_MIN_LEAD_MS).toISOString(),
    startBeforeIso: new Date(now.getTime() + 28 * 3_600_000).toISOString(),
    limit: cap * 5,
  });
  result.considered = candidates.length;

  const due = candidates.filter((c) => {
    const b = byId.get(c.business_id);
    return !!b && reminderVerdict(c, b.minutes, now) === "due";
  });
  if (due.length === 0) return result;

  const existing = await deps.reminders.existingReminderKeys(due.map((c) => c.id));
  for (const c of due) {
    if (result.planned >= cap) break;
    if (existing.has(reminderKey(c.id, c.start_time))) {
      result.alreadyPlanned += 1;
      continue;
    }
    // appointments added by hand without a phone carry a placeholder number: nobody to remind
    if (!c.phone || isPlaceholderPhone(c.phone) || !normalizeIsraeliMobile(c.phone).ok) {
      result.noPhone += 1;
      continue;
    }
    const b = byId.get(c.business_id)!;
    const row = await enqueueSms(
      {
        kind: "reminder",
        appointmentId: c.id,
        phone: c.phone,
        forStartTime: c.start_time,
        business: { id: b.id, slug: b.slug, settings: { sms_reminder_minutes: b.minutes } },
      },
      deps.sms,
      ctx
    );
    if (row) result.planned += 1;
    else result.alreadyPlanned += 1; // someone else queued it a moment ago
  }
  return result;
}
