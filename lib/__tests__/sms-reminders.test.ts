import { describe, expect, it, vi } from "vitest";
import {
  REMINDER_GRACE_MS,
  planDueReminders,
  reminderKey,
  reminderSendAt,
  reminderVerdict,
  type ReminderBusiness,
  type ReminderCandidate,
  type ReminderRepo,
} from "@/lib/sms/reminders";
import { processSmsRow } from "@/lib/sms/outbox";
import { countSegments, DEFAULT_REMINDER_TEMPLATE, renderSmsMessageDetailed } from "@/lib/sms/message";
import { ENV, appt, biz, ctx, fakeRepo, ok, type FakeRow } from "./helpers/sms-fakes";

const MIN = 60_000;
/** Thursday 5 Nov 2026, 12:00 in Israel (winter time, UTC+2) */
const NOW = new Date("2026-11-05T10:00:00Z");
const iso = (ms: number) => new Date(ms).toISOString();
const t = (offsetMin: number) => iso(NOW.getTime() + offsetMin * MIN);

interface Appt {
  id: string;
  business_id: string;
  start_time: string;
  created_at: string;
  phone: string | null;
  status?: "confirmed" | "cancelled";
  service_id?: string | null;
}

/** Everything the planner reads, in memory. Mirrors what the database queries return. */
function world(businesses: ReminderBusiness[], appointments: Appt[], smsRows: Map<string, FakeRow>) {
  const reminders: ReminderRepo = {
    async listReminderBusinesses() {
      return businesses;
    },
    async listReminderCandidates({ businessIds, startAfterIso, startBeforeIso, limit }) {
      return appointments
        .filter(
          (a) =>
            businessIds.includes(a.business_id) &&
            (a.status ?? "confirmed") === "confirmed" &&
            (a.service_id === undefined ? true : a.service_id !== null) &&
            a.start_time > startAfterIso &&
            a.start_time <= startBeforeIso
        )
        .sort((x, y) => x.start_time.localeCompare(y.start_time))
        .slice(0, limit) as ReminderCandidate[];
    },
    async existingReminderKeys(ids) {
      const keys = new Set<string>();
      for (const r of smsRows.values()) {
        if (r.kind === "reminder" && r.for_start_time && ids.includes(r.appointment_id)) {
          keys.add(reminderKey(r.appointment_id, r.for_start_time));
        }
      }
      return keys;
    },
  };
  return reminders;
}

const BIZ_ID = "biz";
const business = (minutes: number, over: Partial<ReminderBusiness> = {}): ReminderBusiness => ({
  id: BIZ_ID,
  slug: "salon-noa",
  minutes,
  ...over,
});
/** An appointment booked well in advance (a week before it starts) */
const booked = (id: string, startOffsetMin: number, over: Partial<Appt> = {}): Appt => ({
  id,
  business_id: BIZ_ID,
  start_time: t(startOffsetMin),
  created_at: iso(NOW.getTime() - 7 * 24 * 60 * MIN),
  phone: "0501234567",
  ...over,
});

function run(businesses: ReminderBusiness[], appointments: Appt[], opts: { cap?: number } = {}) {
  const sms = fakeRepo(undefined, undefined, () => NOW);
  const reminders = world(businesses, appointments, sms.rows);
  const plan = () => planDueReminders({ reminders, sms: sms.repo }, opts, { env: ENV, now: () => NOW });
  return { ...sms, plan };
}

const reminderRows = (rows: Map<string, FakeRow>) => [...rows.values()].filter((r) => r.kind === "reminder");

describe("reminderSendAt", () => {
  it.each([15, 30, 60, 120])("%i minutes before the start, exactly", (n) => {
    const start = "2026-11-05T13:30:00Z";
    expect(reminderSendAt(start, n)!.getTime()).toBe(new Date(start).getTime() - n * MIN);
  });

  it("0 or less is never", () => {
    expect(reminderSendAt("2026-11-05T13:30:00Z", 0)).toBeNull();
    expect(reminderSendAt("2026-11-05T13:30:00Z", -5)).toBeNull();
    expect(reminderSendAt("not a date", 60)).toBeNull();
  });

  describe("a day before, in Israel time, never before 08:00 or after 21:00", () => {
    // winter: Israel is UTC+2. 12 Nov is a Thursday.
    const local = (h: number, m = 0) => new Date(Date.UTC(2026, 10, 12, h - 2, m)).toISOString();
    const sendLocal = (startIso: string) => {
      const d = reminderSendAt(startIso, 1440)!;
      return d.toISOString();
    };

    it("keeps the same time the day before when it is inside 08:00-21:00", () => {
      expect(sendLocal(local(12, 30))).toBe(new Date(Date.UTC(2026, 10, 11, 10, 30)).toISOString());
      expect(sendLocal(local(8, 0))).toBe(new Date(Date.UTC(2026, 10, 11, 6, 0)).toISOString());
      expect(sendLocal(local(21, 0))).toBe(new Date(Date.UTC(2026, 10, 11, 19, 0)).toISOString());
    });

    it("before 08:00 -> 08:00 the day before", () => {
      for (const [h, m] of [[7, 59], [7, 0], [3, 30], [0, 0]]) {
        expect(sendLocal(local(h, m))).toBe(new Date(Date.UTC(2026, 10, 11, 6, 0)).toISOString());
      }
    });

    it("after 21:00 -> 21:00 the day before", () => {
      for (const [h, m] of [[21, 1], [22, 0], [23, 45]]) {
        expect(sendLocal(local(h, m))).toBe(new Date(Date.UTC(2026, 10, 11, 19, 0)).toISOString());
      }
    });

    it("is always before the appointment and within a day of it", () => {
      for (let h = 0; h < 24; h++) {
        const start = local(h, 15);
        const send = reminderSendAt(start, 1440)!.getTime();
        expect(send).toBeLessThan(new Date(start).getTime());
        expect(new Date(start).getTime() - send).toBeLessThanOrEqual(27 * 60 * MIN);
      }
    });
  });

  describe("around the Israel summer-time switches", () => {
    it("clocks go back on Sunday 25 Oct 2026 (a 25-hour day): same wall-clock time the day before", () => {
      // Sunday 10:00 Israel = 08:00Z (UTC+2). Saturday 24 Oct 10:00 Israel = 07:00Z (still UTC+3).
      expect(reminderSendAt("2026-10-25T08:00:00Z", 1440)!.toISOString()).toBe("2026-10-24T07:00:00.000Z");
    });

    it("clocks go forward on Friday 27 Mar 2026 (a 23-hour day): same wall-clock time the day before", () => {
      // Friday 10:00 Israel = 07:00Z (UTC+3). Thursday 26 Mar 10:00 Israel = 08:00Z (UTC+2).
      expect(reminderSendAt("2026-03-27T07:00:00Z", 1440)!.toISOString()).toBe("2026-03-26T08:00:00.000Z");
    });

    it("a night appointment right after the switch is moved to 08:00 of the day before", () => {
      // Friday 27 Mar 03:30 Israel (just after the clocks moved) = 00:30Z; the day before at 08:00 = 06:00Z
      expect(reminderSendAt("2026-03-27T00:30:00Z", 1440)!.toISOString()).toBe("2026-03-26T06:00:00.000Z");
      // Saturday 28 Mar 02:30: the same wall-clock time on Friday does not exist (02:00-03:00 was skipped)
      expect(reminderSendAt("2026-03-27T23:30:00Z", 1440)!.toISOString()).toBe("2026-03-27T05:00:00.000Z");
    });

    it("an appointment right after clocks go back: the day before is 08:00 local (UTC+2 after the switch)", () => {
      // Monday 26 Oct 01:30 Israel (UTC+2) = 23:30Z on the 25th; the day before 08:00 = Sunday 25 Oct 08:00 (UTC+2) = 06:00Z
      expect(reminderSendAt("2026-10-25T23:30:00Z", 1440)!.toISOString()).toBe("2026-10-25T06:00:00.000Z");
    });
  });
});

describe("reminderVerdict (when a reminder is due)", () => {
  const a = (startOffsetMin: number, createdOffsetMin = -7 * 24 * 60) => ({
    start_time: t(startOffsetMin),
    created_at: t(createdOffsetMin),
  });

  it("due exactly at the send time", () => {
    expect(reminderVerdict(a(60), 60, NOW)).toBe("due");
  });
  it("not yet one minute before the send time", () => {
    expect(reminderVerdict(a(61), 60, NOW)).toBe("not_yet");
  });
  it("still due 30 minutes late (the grace window), too late after that", () => {
    expect(REMINDER_GRACE_MS).toBe(30 * MIN);
    expect(reminderVerdict(a(30), 60, NOW)).toBe("due"); // sendAt was exactly 30 minutes ago
    expect(reminderVerdict(a(29), 60, NOW)).toBe("too_late"); // 31 minutes ago
  });
  it("not for an appointment that starts within 5 minutes", () => {
    expect(reminderVerdict(a(5), 15, NOW)).toBe("too_close");
    expect(reminderVerdict(a(4), 15, NOW)).toBe("too_close");
    expect(reminderVerdict(a(16), 15, NOW)).toBe("not_yet");
    expect(reminderVerdict(a(6), 30, NOW)).toBe("due");
  });
  it("not when the appointment was booked after the send time (the confirmation covers it)", () => {
    // starts in 100 minutes, reminder 120 minutes before: it became due 20 minutes ago
    expect(reminderVerdict(a(100, -10), 120, NOW)).toBe("booked_after_send_time"); // booked 10 minutes ago
    expect(reminderVerdict(a(100, -20), 120, NOW)).toBe("booked_after_send_time"); // booked exactly at the send time
    expect(reminderVerdict(a(100, -21), 120, NOW)).toBe("due"); // booked a minute before the send time
  });
});

describe("planDueReminders: each option", () => {
  it.each([15, 30, 60, 120])("%i minutes: queues the reminder of an appointment that starts in that time", async (n) => {
    const { plan, rows } = run([business(n)], [booked("a1", n)]);
    expect(await plan()).toMatchObject({ planned: 1 });
    const [row] = reminderRows(rows);
    expect(row).toMatchObject({
      kind: "reminder",
      appointment_id: "a1",
      status: "pending",
      to_phone: "501234567",
      business_id: BIZ_ID,
      for_start_time: t(n),
    });
  });

  it("a day before: queues it when the clamped time has come", async () => {
    // Friday 6 Nov 12:00 Israel = 10:00Z; the day before 12:00 = now
    const { plan, rows } = run([business(1440)], [booked("a1", 24 * 60)]);
    expect(await plan()).toMatchObject({ planned: 1 });
    expect(reminderRows(rows)).toHaveLength(1);
  });

  it("a day before with quiet hours: an early-morning appointment is reminded at 08:00 the day before", async () => {
    // Friday 6 Nov 06:30 Israel = 04:30Z: the day before 06:30 is too early, so 08:00 Thursday = 06:00Z.
    const start = "2026-11-06T04:30:00Z";
    const early = booked("a1", 0, { start_time: start });
    const before = new Date("2026-11-05T05:59:00Z"); // 07:59 Israel: not yet
    const at = new Date("2026-11-05T06:00:00Z"); // 08:00 Israel: due
    const sms = fakeRepo();
    const reminders = world([business(1440)], [early], sms.rows);
    const deps = { reminders, sms: sms.repo };
    expect((await planDueReminders(deps, {}, { env: ENV, now: () => before })).planned).toBe(0);
    expect((await planDueReminders(deps, {}, { env: ENV, now: () => at })).planned).toBe(1);
  });

  it("not for an appointment whose time has not come yet", async () => {
    const { plan, rows } = run([business(60)], [booked("a1", 61), booked("a2", 600)]);
    expect(await plan()).toMatchObject({ planned: 0 });
    expect(rows.size).toBe(0);
  });

  it("not when the business has reminders off (0), or nothing set", async () => {
    const { plan, rows } = run([business(0)], [booked("a1", 60)]);
    expect(await plan()).toMatchObject({ planned: 0, businesses: 0 });
    expect(rows.size).toBe(0);
  });

  it("each business uses its own setting", async () => {
    const other = { id: "biz2", slug: "other", minutes: 30 };
    const { plan, rows } = run(
      [business(60), other],
      [booked("a1", 60), booked("a2", 30, { business_id: "biz2" }), booked("a3", 60, { business_id: "biz2" })]
    );
    expect(await plan()).toMatchObject({ planned: 2 });
    expect(reminderRows(rows).map((r) => r.appointment_id).sort()).toEqual(["a1", "a2"]);
  });
});

describe("planDueReminders: the other rules", () => {
  it("grace window: 30 minutes late is still sent, 31 is not", async () => {
    const { plan, rows } = run([business(60)], [booked("late-ok", 30), booked("too-late", 29)]);
    await plan();
    expect(reminderRows(rows).map((r) => r.appointment_id)).toEqual(["late-ok"]);
  });

  it("an appointment booked after the send time gets no reminder", async () => {
    // start in 60 min, reminder 120 min before; booked 90 minutes ago (after the send time)
    const { plan, rows } = run([business(120)], [booked("a1", 60, { created_at: t(-90) })]);
    expect(await plan()).toMatchObject({ planned: 0 });
    expect(rows.size).toBe(0);
  });

  it("a day before: booked after the reminder time gets none; booked days ahead does", async () => {
    // the day-before reminder became due 20 minutes ago (the start is 11:40 Israel time tomorrow)
    const start = 24 * 60 - 20;
    const { plan, rows } = run(
      [business(1440)],
      [booked("early-bird", start), booked("last-minute", start, { created_at: t(-10) })]
    );
    await plan();
    expect(reminderRows(rows).map((r) => r.appointment_id)).toEqual(["early-bird"]);
  });

  it("not for an appointment that starts in less than 5 minutes", async () => {
    const { plan, rows } = run([business(15)], [booked("a1", 4)]);
    await plan();
    expect(rows.size).toBe(0);
  });

  it("cancelled appointments, blocked time and past appointments are never looked at", async () => {
    const { plan, rows } = run(
      [business(60)],
      [
        booked("cancelled", 60, { status: "cancelled" }),
        booked("blocked-time", 60, { service_id: null }),
        booked("past", -30),
      ]
    );
    expect(await plan()).toMatchObject({ planned: 0 });
    expect(rows.size).toBe(0);
  });

  it("appointments added by hand are reminded too", async () => {
    // (they have a client with a real phone; nothing marks them as "manual" for the planner)
    const { plan, rows } = run([business(60)], [booked("manual", 60)]);
    expect(await plan()).toMatchObject({ planned: 1 });
    expect(reminderRows(rows)).toHaveLength(1);
  });

  it("nobody to remind: no phone, the quick-add placeholder, a landline", async () => {
    const { plan, rows } = run(
      [business(60)],
      [
        booked("none", 60, { phone: null }),
        booked("placeholder", 60, { phone: "0500000000" }),
        booked("placeholder2", 60, { phone: "050-0000000" }),
        booked("blocked-client", 60, { phone: "0000000000" }),
        booked("landline", 60, { phone: "031234567" }),
      ]
    );
    const r = await plan();
    expect(r).toMatchObject({ planned: 0, noPhone: 5 });
    expect(rows.size).toBe(0);
  });

  it("a demo business is never planned: no rows at all, whatever its setting", async () => {
    const { plan, rows } = run(
      [{ id: "a1111111-1111-1111-1111-111111111111", slug: "barber-dan", minutes: 60 }, { id: "x", slug: "maya-nails", minutes: 60 }],
      [
        booked("d1", 60, { business_id: "a1111111-1111-1111-1111-111111111111" }),
        booked("d2", 60, { business_id: "x" }),
      ]
    );
    expect(await plan()).toMatchObject({ planned: 0, businesses: 0 });
    expect(rows.size).toBe(0);
  });

  it("the per-phone limit applies: the row is queued as skipped", async () => {
    const { plan, rows, repo } = run([business(60)], [booked("a1", 60)]);
    await repo.insert({ appointmentId: "x1", kind: "booked", toPhone: "501234567", status: "pending" });
    await repo.insert({ appointmentId: "x2", kind: "booked", toPhone: "501234567", status: "sent" });
    await plan();
    expect(reminderRows(rows)[0]).toMatchObject({ status: "skipped", error: "phone_limit_hour" });
  });

  it("at most `cap` reminders per run", async () => {
    const many = Array.from({ length: 5 }, (_, i) => booked(`a${i}`, 60, { phone: `05012345${10 + i}` }));
    const { plan, rows } = run([business(60)], many, { cap: 2 });
    expect(await plan()).toMatchObject({ planned: 2 });
    expect(reminderRows(rows)).toHaveLength(2);
  });
});

describe("planDueReminders: running twice", () => {
  it("queues every reminder once (the cron job may overlap itself)", async () => {
    const { plan, rows } = run([business(60)], [booked("a1", 60), booked("a2", 45, { phone: "0521112222" })]);
    expect(await plan()).toMatchObject({ planned: 2, alreadyPlanned: 0 });
    expect(await plan()).toMatchObject({ planned: 0, alreadyPlanned: 2 });
    expect(reminderRows(rows)).toHaveLength(2);
  });

  it("two instances at the same moment: the unique row wins, nobody errors", async () => {
    const sms = fakeRepo();
    const reminders = world([business(60)], [booked("a1", 60)], sms.rows);
    // both read "nothing exists yet", both try to insert
    const racing: ReminderRepo = { ...reminders, existingReminderKeys: async () => new Set() };
    const deps = { reminders: racing, sms: sms.repo };
    const [a, b] = await Promise.all([
      planDueReminders(deps, {}, { env: ENV, now: () => NOW }),
      planDueReminders(deps, {}, { env: ENV, now: () => NOW }),
    ]);
    expect(a.planned + b.planned).toBe(1);
    expect(reminderRows(sms.rows)).toHaveLength(1);
  });

  it("does not re-plan a reminder that was already sent or skipped", async () => {
    const { plan, rows } = run([business(60)], [booked("a1", 60)]);
    await plan();
    reminderRows(rows)[0].status = "skipped";
    expect(await plan()).toMatchObject({ planned: 0 });
    expect(reminderRows(rows)).toHaveLength(1);
  });
});

describe("a rescheduled appointment", () => {
  it("gets a new reminder for its new time, and the sent one stays", async () => {
    const sms = fakeRepo();
    const apps = [booked("a1", 60)];
    const reminders = world([business(60)], apps, sms.rows);
    const deps = { reminders, sms: sms.repo };

    // first time: reminder queued and sent
    await planDueReminders(deps, {}, { env: ENV, now: () => NOW });
    const first = reminderRows(sms.rows)[0];
    first.status = "sent";
    const firstStart = first.for_start_time;

    // the customer moves the appointment to the next day, an hour later; its reminder is due then
    apps[0].start_time = t(24 * 60 + 60);
    const later = new Date(NOW.getTime() + 24 * 60 * MIN);
    const r = await planDueReminders(deps, {}, { env: ENV, now: () => later });
    expect(r.planned).toBe(1);

    const all = reminderRows(sms.rows);
    expect(all).toHaveLength(2);
    expect(all.find((x) => x.for_start_time === firstStart)).toMatchObject({ status: "sent" }); // kept: usage is not lost
    expect(all.find((x) => x.for_start_time === t(24 * 60 + 60))).toMatchObject({ status: "pending" });
  });

  it("a pending reminder of the old time is skipped right before sending (appointment_moved)", async () => {
    const oldStart = "2026-11-05T13:30:00Z";
    const moved = appt({ start_time: "2026-11-06T13:30:00Z", end_time: "2026-11-06T14:15:00Z" });
    const { repo, rows } = fakeRepo(moved, biz({ sms_reminder_minutes: 60 }));
    const row = await repo.insert({ appointmentId: "appt-1", kind: "reminder", forStartTime: oldStart, toPhone: "501234567", status: "pending" });
    const fetchImpl = ok();
    expect(await processSmsRow(row!.id, repo, ctx(fetchImpl, new Date("2026-11-05T12:00:00Z")))).toBe("skipped");
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(rows.get(row!.id)).toMatchObject({ status: "skipped", error: "appointment_moved" });
  });

  it("a reminder row without its start time is refused too", async () => {
    const { repo, rows } = fakeRepo(appt(), biz({ sms_reminder_minutes: 60 }));
    const row = await repo.insert({ appointmentId: "appt-1", kind: "reminder", toPhone: "501234567", status: "pending" });
    const fetchImpl = ok();
    expect(await processSmsRow(row!.id, repo, ctx(fetchImpl))).toBe("skipped");
    expect(rows.get(row!.id)!.error).toBe("appointment_moved");
  });
});

describe("sending a reminder", () => {
  const START = "2026-11-05T13:30:00Z"; // 15:30 Israel
  const queue = async (settings: Parameters<typeof biz>[0], over: Parameters<typeof appt>[0] = {}) => {
    const made = fakeRepo(appt(over), biz(settings));
    const row = await made.repo.insert({ appointmentId: "appt-1", kind: "reminder", forStartTime: START, toPhone: "501234567", status: "pending" });
    return { ...made, id: row!.id };
  };
  const sentText = (fetchImpl: ReturnType<typeof vi.fn>) => JSON.parse(fetchImpl.mock.calls[0][1].body).sms.message as string;

  it("goes out with the default reminder wording and a fresh manage link", async () => {
    const { repo, rows, tokens, id } = await queue({ sms_reminder_minutes: 60 });
    const fetchImpl = ok();
    expect(await processSmsRow(id, repo, ctx(fetchImpl, new Date("2026-11-05T12:00:00Z")))).toBe("sent");
    const text = sentText(fetchImpl);
    expect(text).toMatch(/^תזכורת לתור בסלון נועה: 05\/11 בשעה 15:30\./);
    expect(text).toMatch(/https:\/\/tornow\.example\/t\/[A-Za-z0-9_-]{32}$/);
    expect(rows.get(id)).toMatchObject({ status: "sent" });
    // the manage link works until the end of the appointment, like the confirmation's
    expect(tokens).toHaveLength(1);
    expect(tokens[0].expires).toBe("2026-11-05T14:15:00Z");
  });

  it("uses the reminder wording, never the confirmation's", async () => {
    const { repo, id } = await queue({
      sms_reminder_minutes: 60,
      sms_reminder_template: "מחכים לך ב-{time} ב{business}. {link}",
      sms_confirmation_template: "זה נוסח האישור {link}",
    });
    const fetchImpl = ok();
    await processSmsRow(id, repo, ctx(fetchImpl, new Date("2026-11-05T12:00:00Z")));
    expect(sentText(fetchImpl)).toMatch(/^מחכים לך ב-15:30 בסלון נועה\. https:/);
    expect(sentText(fetchImpl)).not.toContain("אישור");
  });

  it("a broken reminder wording falls back to the default reminder wording", async () => {
    const { repo, id } = await queue({ sms_reminder_minutes: 60, sms_reminder_template: "הנחה! https://evil.test {link}" });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const fetchImpl = ok();
    await processSmsRow(id, repo, ctx(fetchImpl, new Date("2026-11-05T12:00:00Z")));
    warn.mockRestore();
    expect(sentText(fetchImpl)).toMatch(/^תזכורת לתור בסלון נועה/);
    expect(sentText(fetchImpl)).not.toContain("evil");
  });

  it("the owner switched reminders off after it was queued: skipped (reminder_disabled)", async () => {
    for (const settings of [{ sms_reminder_minutes: 0 }, {}]) {
      const { repo, rows, id } = await queue(settings);
      const fetchImpl = ok();
      expect(await processSmsRow(id, repo, ctx(fetchImpl, new Date("2026-11-05T12:00:00Z")))).toBe("skipped");
      expect(fetchImpl).not.toHaveBeenCalled();
      expect(rows.get(id)).toMatchObject({ status: "skipped", error: "reminder_disabled" });
    }
  });

  it("the confirmation switch does not touch reminders, and reminders do not touch the confirmation", async () => {
    const { repo, id } = await queue({ sms_confirmation_enabled: false, sms_reminder_minutes: 60 });
    const fetchImpl = ok();
    expect(await processSmsRow(id, repo, ctx(fetchImpl, new Date("2026-11-05T12:00:00Z")))).toBe("sent");

    const confirmation = fakeRepo(appt(), biz({ sms_confirmation_enabled: true, sms_reminder_minutes: 0 }));
    const row = await confirmation.repo.insert({ appointmentId: "appt-1", kind: "booked", toPhone: "501234567", status: "pending" });
    expect(await processSmsRow(row!.id, confirmation.repo, ctx(ok()))).toBe("sent");
  });

  it("a cancelled or already started appointment gets no reminder", async () => {
    const cancelled = await queue({ sms_reminder_minutes: 60 }, { status: "cancelled" });
    expect(await processSmsRow(cancelled.id, cancelled.repo, ctx(ok(), new Date("2026-11-05T12:00:00Z")))).toBe("skipped");
    expect(cancelled.rows.get(cancelled.id)!.error).toBe("appointment_cancelled");

    const started = await queue({ sms_reminder_minutes: 60 });
    expect(await processSmsRow(started.id, started.repo, ctx(ok(), new Date("2026-11-05T14:00:00Z")))).toBe("skipped");
    expect(started.rows.get(started.id)!.error).toBe("appointment_past");
  });

  it("a reminder and a confirmation can both exist for one appointment", async () => {
    const { repo } = fakeRepo();
    const a = await repo.insert({ appointmentId: "x", kind: "booked", toPhone: "501234567", status: "pending" });
    const b = await repo.insert({ appointmentId: "x", kind: "reminder", forStartTime: START, toPhone: "501234567", status: "pending" });
    expect(a).not.toBeNull();
    expect(b).not.toBeNull();
    expect(await repo.insert({ appointmentId: "x", kind: "booked", toPhone: "501234567", status: "pending" })).toBeNull();
  });
});

describe("the default reminder wording", () => {
  const LINK = `https://tornow-eight.vercel.app/t/${"a".repeat(32)}`;

  it("is at most 2 SMS segments with the real 66-character link", () => {
    expect(LINK).toHaveLength(66);
    const text = renderSmsMessageDetailed("reminder", null, {
      name: "דנה",
      business: "סלון נועה",
      service: "תספורת",
      date: "05/11",
      time: "15:30",
      link: LINK,
    }).text;
    expect(text).toBe(`תזכורת לתור בסלון נועה: 05/11 בשעה 15:30.\nלשינוי/ביטול: ${LINK}`);
    expect(countSegments(text).segments).toBeLessThanOrEqual(2);
  });

  it("is the suggested text, and stays 2 segments for a business name up to 18 characters", () => {
    expect(DEFAULT_REMINDER_TEMPLATE).toBe("תזכורת לתור ב{business}: {date} בשעה {time}.\nלשינוי/ביטול: {link}");
    const text = renderSmsMessageDetailed("reminder", undefined, {
      business: "ב".repeat(18),
      date: "05/11",
      time: "15:30",
      link: LINK,
    }).text;
    expect(countSegments(text).segments).toBeLessThanOrEqual(2);
  });

  it("never shortens the link, even for the longest business name", () => {
    const text = renderSmsMessageDetailed("reminder", null, {
      business: "ע".repeat(120),
      date: "05/11",
      time: "15:30",
      link: LINK,
    }).text;
    expect(text.endsWith(LINK)).toBe(true);
  });
});
