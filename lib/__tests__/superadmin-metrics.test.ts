import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { createMemorySource } from "@/lib/superadmin/memory-source";
import { buildMetrics, parsePriceAgorot, pct, windowsFor } from "@/lib/superadmin/metrics";
import {
  dayKey,
  israelDayStart,
  israelMonthStart,
  lastDayKeys,
  lastMonthKeys,
  monthKey,
} from "@/lib/superadmin/time";
import { MANUAL_BOOKING_NOTE } from "@/lib/superadmin/config";
import { DAY, ENV_ALL, NOW, addAppointment, addBusiness, addSms, ago, emptyData } from "./helpers/superadmin-fakes";

const build = (data = emptyData(), env: Record<string, string | undefined> = ENV_ALL, now: Date = NOW) =>
  buildMetrics(createMemorySource(data), { now, env });

describe("Israel days and months", () => {
  it("a day starts at Israel midnight: summer (UTC+3) and winter (UTC+2)", () => {
    expect(israelDayStart(new Date("2026-07-20T10:00:00Z")).toISOString()).toBe("2026-07-19T21:00:00.000Z");
    expect(israelDayStart(new Date("2026-12-20T10:00:00Z")).toISOString()).toBe("2026-12-19T22:00:00.000Z");
  });

  it("right around midnight the Israel date counts, not the UTC one", () => {
    // 2026-11-05 22:30Z is already 6 November in Israel (UTC+2)
    expect(dayKey(new Date("2026-11-05T22:30:00Z"))).toBe("2026-11-06");
    expect(dayKey(new Date("2026-11-05T21:59:59Z"))).toBe("2026-11-05");
    expect(israelDayStart(new Date("2026-11-05T22:30:00Z")).toISOString()).toBe("2026-11-05T22:00:00.000Z");
    // in summer the boundary is at 21:00Z
    expect(dayKey(new Date("2026-07-20T20:59:59Z"))).toBe("2026-07-20");
    expect(dayKey(new Date("2026-07-20T21:00:00Z"))).toBe("2026-07-21");
  });

  it("the day clocks go back (25 Oct 2026, 25 hours) and the day they go forward (27 Mar 2026, 23 hours)", () => {
    const back = israelDayStart(new Date("2026-10-25T12:00:00Z"));
    const backNext = israelDayStart(new Date("2026-10-26T12:00:00Z"));
    expect(back.toISOString()).toBe("2026-10-24T21:00:00.000Z"); // midnight still UTC+3
    expect(backNext.toISOString()).toBe("2026-10-25T22:00:00.000Z"); // midnight now UTC+2
    expect((backNext.getTime() - back.getTime()) / 3_600_000).toBe(25);

    const fwd = israelDayStart(new Date("2026-03-27T12:00:00Z"));
    const fwdNext = israelDayStart(new Date("2026-03-28T12:00:00Z"));
    expect(fwd.toISOString()).toBe("2026-03-26T22:00:00.000Z");
    expect(fwdNext.toISOString()).toBe("2026-03-27T21:00:00.000Z");
    expect((fwdNext.getTime() - fwd.getTime()) / 3_600_000).toBe(23);
  });

  it("the last 30 days: every calendar day exactly once, across a DST switch", () => {
    const keys = lastDayKeys(new Date("2026-11-05T10:00:00Z"), 30);
    expect(keys).toHaveLength(30);
    expect(new Set(keys).size).toBe(30);
    expect(keys[29]).toBe("2026-11-05");
    expect(keys[0]).toBe("2026-10-07");
    expect(keys).toContain("2026-10-25"); // the 25-hour day
    // consecutive calendar days, no gap and no repeat
    for (let i = 1; i < keys.length; i++) {
      const prev = Date.UTC(+keys[i - 1].slice(0, 4), +keys[i - 1].slice(5, 7) - 1, +keys[i - 1].slice(8, 10));
      const cur = Date.UTC(+keys[i].slice(0, 4), +keys[i].slice(5, 7) - 1, +keys[i].slice(8, 10));
      expect(cur - prev).toBe(DAY);
    }
    const spring = lastDayKeys(new Date("2026-04-02T10:00:00Z"), 10);
    expect(spring).toContain("2026-03-27");
    expect(new Set(spring).size).toBe(10);
  });

  it("months: the start of a month in Israel time, and the last six", () => {
    expect(israelMonthStart(new Date("2026-07-20T10:00:00Z")).toISOString()).toBe("2026-06-30T21:00:00.000Z");
    expect(israelMonthStart(new Date("2026-12-20T10:00:00Z")).toISOString()).toBe("2026-11-30T22:00:00.000Z");
    // 31 Oct 22:30Z is already 1 November in Israel
    expect(monthKey(new Date("2026-10-31T22:30:00Z"))).toBe("2026-11");
    expect(monthKey(new Date("2026-10-31T21:30:00Z"))).toBe("2026-10");
    expect(lastMonthKeys(new Date("2026-02-10T10:00:00Z"), 6)).toEqual(["2025-09", "2025-10", "2025-11", "2025-12", "2026-01", "2026-02"]);
  });

  it("the windows: today, last 7 days, last 30 days and the month, all from Israel midnight", () => {
    const w = windowsFor(NOW);
    expect(w.todayStart).toBe("2026-11-04T22:00:00.000Z");
    expect(w.weekStart).toBe("2026-10-29T22:00:00.000Z"); // 6 days before: 7 days with today
    expect(w.since30).toBe("2026-10-06T21:00:00.000Z"); // 29 days before, still summer time on that date
    expect(w.since14).toBe("2026-10-22T21:00:00.000Z");
    expect(w.monthStart).toBe("2026-10-31T22:00:00.000Z");
  });
});

describe("overview: businesses", () => {
  it("counts registered, new today / 7 days / 30 days", () => {
    const d = emptyData();
    addBusiness(d, "a", { created: ago(2 * 60 * 60 * 1000) }); // 10:00Z-2h = 08:00Z: today (Israel 10:00)
    addBusiness(d, "b", { created: ago(3 * DAY) });
    addBusiness(d, "c", { created: ago(20 * DAY) });
    addBusiness(d, "d", { created: ago(60 * DAY) });
    return build(d).then((m) => {
      expect(m.overview.businesses.total).toBe(4);
      expect(m.overview.businesses.new).toEqual({ today: 1, last7: 2, last30: 3 });
    });
  });

  it("a business registered a minute before Israel midnight is not 'new today', one a minute after is", async () => {
    const d = emptyData();
    addBusiness(d, "before", { created: "2026-11-04T21:59:00.000Z" }); // 23:59 on the 4th in Israel
    addBusiness(d, "after", { created: "2026-11-04T22:01:00.000Z" }); // 00:01 on the 5th
    const m = await build(d);
    expect(m.overview.businesses.new.today).toBe(1);
  });

  it("demo businesses are shown in the table and left out of EVERY number", async () => {
    const d = emptyData();
    addBusiness(d, "real", { slug: "salon-noa", created: ago(30 * DAY) });
    addAppointment(d, "real", { created: ago(1 * DAY) });
    addBusiness(d, "a1111111-1111-1111-1111-111111111111", { slug: "barber-dan", created: ago(1 * DAY) });
    addBusiness(d, "demo2", { slug: "maya-nails", created: ago(1 * DAY) });
    addBusiness(d, "demo3", { slug: "clinic-rafael", created: ago(1 * DAY) });
    for (const id of ["a1111111-1111-1111-1111-111111111111", "demo2", "demo3"]) {
      for (let i = 0; i < 5; i++) addAppointment(d, id, { created: ago(1000 * (i + 1)) });
    }
    const m = await build(d);

    expect(m.overview.businesses.total).toBe(1);
    expect(m.overview.businesses.active).toBe(1);
    expect(m.overview.businesses.demoExcluded).toBe(3);
    expect(m.overview.businesses.new.last7).toBe(0);
    expect(m.overview.appointments.last7.total).toBe(1);
    expect(m.funnel.steps[0].count).toBe(1);
    // ... but the table still lists them, marked
    expect(m.businesses.total).toBe(4);
    expect(m.businesses.rows.filter((r) => r.isDemo).map((r) => r.slug).sort()).toEqual(["barber-dan", "clinic-rafael", "maya-nails"]);
    expect(m.businesses.rows.find((r) => r.slug === "salon-noa")?.isDemo).toBe(false);
  });

  it("a business is matched as a demo by id even when its slug was renamed", async () => {
    const d = emptyData();
    addBusiness(d, "a1111111-1111-1111-1111-111111111111", { slug: "renamed", created: ago(2 * DAY) });
    const m = await build(d);
    expect(m.overview.businesses.total).toBe(0);
    expect(m.businesses.rows[0].isDemo).toBe(true);
  });
});

describe("active and dormant", () => {
  it("active: at least one CONFIRMED appointment created in the last 30 days", async () => {
    const d = emptyData();
    addBusiness(d, "confirmed");
    addAppointment(d, "confirmed", { created: ago(5 * DAY) });
    addBusiness(d, "only-cancelled");
    addAppointment(d, "only-cancelled", { created: ago(5 * DAY), status: "cancelled" });
    addBusiness(d, "old");
    addAppointment(d, "old", { created: ago(45 * DAY) });
    addBusiness(d, "blocked-only");
    addAppointment(d, "blocked-only", { created: ago(2 * DAY), blocked: true });
    const m = await build(d);
    expect(m.overview.businesses.active).toBe(1);
  });

  it("dormant: registered more than 14 days ago and no appointment ever", async () => {
    const d = emptyData();
    addBusiness(d, "dormant", { created: ago(15 * DAY) });
    addBusiness(d, "too-new", { created: ago(13 * DAY) });
    addBusiness(d, "has-one-old", { created: ago(60 * DAY) });
    addAppointment(d, "has-one-old", { created: ago(50 * DAY) });
    addBusiness(d, "only-cancelled", { created: ago(60 * DAY) });
    addAppointment(d, "only-cancelled", { created: ago(50 * DAY), status: "cancelled" });
    addBusiness(d, "only-blocked", { created: ago(60 * DAY) });
    addAppointment(d, "only-blocked", { created: ago(50 * DAY), blocked: true });
    const m = await build(d);
    // dormant: the one never booked, and the one with blocked time only (blocked time is not an appointment)
    expect(m.overview.businesses.dormant).toBe(2);
  });

  it("exactly 14 days is not yet 'more than 14 days'", async () => {
    const d = emptyData();
    addBusiness(d, "edge", { created: ago(14 * DAY) });
    addBusiness(d, "just-over", { created: ago(14 * DAY + 1000) });
    expect((await build(d)).overview.businesses.dormant).toBe(1);
  });
});

describe("overview: appointments", () => {
  it("today / last 7 days / this month, split into the public page and the owner's own form", async () => {
    const d = emptyData();
    addBusiness(d, "a");
    addAppointment(d, "a", { created: ago(60 * 60 * 1000) }); // today
    addAppointment(d, "a", { created: ago(2 * 60 * 60 * 1000), manual: true }); // today, manual
    addAppointment(d, "a", { created: ago(3 * DAY) }); // this week
    addAppointment(d, "a", { created: ago(4 * DAY), manual: true });
    addAppointment(d, "a", { created: ago(10 * DAY) }); // this month only (5 Nov: month began 1 Nov... 10 days ago is October)
    addAppointment(d, "a", { created: ago(2 * DAY), blocked: true }); // blocked time: not an appointment
    const m = await build(d);
    const a = m.overview.appointments;
    expect(a.today).toEqual({ total: 2, manual: 1, public: 1 });
    expect(a.last7).toEqual({ total: 4, manual: 2, public: 2 });
    // 1 November 00:00 Israel is 31 Oct 22:00Z: only appointments created from then on
    expect(a.month.total).toBe(4);
  });

  it("the manual marker is the exact note of the owner's form", async () => {
    const d = emptyData();
    addBusiness(d, "a");
    addAppointment(d, "a", { created: ago(1000), manual: true });
    d.appointments.push({ business_id: "a", service_id: "svc", status: "confirmed", notes: "הערה של לקוח", created_at: ago(2000) });
    const m = await build(d);
    expect(m.overview.appointments.today).toEqual({ total: 2, manual: 1, public: 1 });
    expect(MANUAL_BOOKING_NOTE).toBe("נוסף ידנית ע״י בית העסק");
    // the owner's form really writes this note (if it is ever reworded, this test says the dashboard must follow)
    expect(readFileSync("app/admin/page.tsx", "utf8")).toContain(`notes: "${MANUAL_BOOKING_NOTE}"`);
  });

  it("cancelled share of the appointments created in the last 30 days; null with none", async () => {
    const d = emptyData();
    addBusiness(d, "a");
    for (let i = 0; i < 3; i++) addAppointment(d, "a", { created: ago((i + 1) * DAY) });
    addAppointment(d, "a", { created: ago(2 * DAY), status: "cancelled" });
    addAppointment(d, "a", { created: ago(50 * DAY), status: "cancelled" }); // too old to count
    const m = await build(d);
    expect(m.overview.appointments.created30d).toBe(4);
    expect(m.overview.appointments.cancelled30d).toBe(1);
    expect(m.overview.appointments.cancelledShare30d).toBe(25);
    expect((await build(emptyData())).overview.appointments.cancelledShare30d).toBeNull();
  });
});

describe("funnel", () => {
  it("registered -> service -> first appointment -> still getting appointments (14 days)", async () => {
    const d = emptyData();
    addBusiness(d, "r1", { services: 0 }); // registered only
    addBusiness(d, "r2", { services: 1 }); // has a service
    addBusiness(d, "r3", { services: 1 });
    addAppointment(d, "r3", { created: ago(40 * DAY) }); // had an appointment, long ago
    addBusiness(d, "r4", { services: 2 });
    addAppointment(d, "r4", { created: ago(3 * DAY) }); // still getting them
    const steps = (await build(d)).funnel.steps;
    expect(steps.map((s) => s.count)).toEqual([4, 3, 2, 1]);
    expect(steps.map((s) => s.pctOfRegistered)).toEqual([100, 75, 50, 25]);
    expect(steps.map((s) => s.pctOfPrevious)).toEqual([null, 75, 66.7, 50]);
  });

  it("no businesses: every percentage is null, never NaN or Infinity", async () => {
    const steps = (await build(emptyData())).funnel.steps;
    expect(steps.map((s) => s.count)).toEqual([0, 0, 0, 0]);
    for (const s of steps) {
      expect(s.pctOfRegistered).toBeNull();
      expect(s.pctOfPrevious).toBeNull();
    }
    expect(JSON.stringify(steps)).not.toMatch(/NaN|Infinity/);
  });

  it("an empty step: the next step has no percentage of it", async () => {
    const d = emptyData();
    addBusiness(d, "only", { services: 0 });
    const steps = (await build(d)).funnel.steps;
    expect(steps.map((s) => s.count)).toEqual([1, 0, 0, 0]);
    expect(steps[1].pctOfRegistered).toBe(0);
    expect(steps[1].pctOfPrevious).toBe(0);
    expect(steps[2].pctOfPrevious).toBeNull(); // 0 of 0
  });

  it("pct()", () => {
    expect(pct(1, 3)).toBe(33.3);
    expect(pct(0, 5)).toBe(0);
    expect(pct(5, 0)).toBeNull();
  });
});

describe("sms", () => {
  it("per Israel day for 30 days (zero-filled) and per month for 6, by kind, sent messages only", async () => {
    const d = emptyData();
    addBusiness(d, "a");
    addSms(d, "a", { kind: "booked", created: "2026-11-05T08:00:00Z", segments: 2 });
    addSms(d, "a", { kind: "booked", created: "2026-11-05T09:00:00Z", segments: 3 });
    addSms(d, "a", { kind: "reminder", created: "2026-11-05T09:30:00Z", segments: 2 });
    addSms(d, "a", { kind: "booked", status: "skipped", reason: "business_disabled", created: "2026-11-05T09:00:00Z", segments: null });
    // 23:30 Israel on the 4th (21:30Z) belongs to the 4th, 00:30 on the 5th (22:30Z on the 4th) to the 5th
    addSms(d, "a", { kind: "booked", created: "2026-11-04T21:30:00Z", segments: 1 });
    addSms(d, "a", { kind: "booked", created: "2026-11-04T22:30:00Z", segments: 1 });
    addSms(d, "a", { kind: "booked", created: "2026-09-15T09:00:00Z", segments: 2 });
    const m = await build(d);

    expect(m.sms.daily).toHaveLength(30);
    expect(m.sms.daily[29]).toMatchObject({ day: "2026-11-05", booked: 3, reminder: 1, other: 0, segments: 8 });
    expect(m.sms.daily.find((x) => x.day === "2026-11-04")).toMatchObject({ booked: 1, segments: 1 });
    expect(m.sms.daily.find((x) => x.day === "2026-11-03")).toMatchObject({ booked: 0, reminder: 0, segments: 0 });

    expect(m.sms.monthly.map((x) => x.month)).toEqual(["2026-06", "2026-07", "2026-08", "2026-09", "2026-10", "2026-11"]);
    expect(m.sms.monthly[5]).toMatchObject({ booked: 4, reminder: 1, segments: 9 }); // 2 + 3 + 2 + 1 + 1
    expect(m.sms.monthly[3]).toMatchObject({ booked: 1, segments: 2 });
    expect(m.sms.monthly[0]).toMatchObject({ booked: 0, reminder: 0 });
  });

  it("other kinds are kept in an 'other' column, so the totals add up", async () => {
    const d = emptyData();
    addBusiness(d, "a");
    addSms(d, "a", { kind: "cancelled", created: ago(1000) });
    expect((await build(d)).sms.daily[29].other).toBe(1);
  });

  it("status breakdown and skip reasons, grouped", async () => {
    const d = emptyData();
    addBusiness(d, "a");
    for (let i = 0; i < 3; i++) addSms(d, "a", { status: "skipped", reason: "phone_limit_hour", segments: null });
    for (let i = 0; i < 2; i++) addSms(d, "a", { status: "skipped", reason: "business_disabled", segments: null });
    addSms(d, "a", { status: "skipped", reason: "phone_limit_day", segments: null });
    addSms(d, "a", { status: "skipped", reason: null, segments: null });
    addSms(d, "a", { status: "failed", reason: "4", segments: null });
    addSms(d, "a", { status: "failed", reason: "4", segments: null });
    addSms(d, "a", { status: "failed", reason: "715", segments: null });
    addSms(d, "a", { status: "pending", segments: null });
    addSms(d, "a", { status: "sent" });
    addSms(d, "a", { status: "sent" });
    const m = await build(d);
    expect(m.sms.status30d).toEqual({ sent: 2, failed: 3, skipped: 7, pending: 1 });
    expect(m.sms.skipReasons30d).toEqual([
      { reason: "phone_limit_hour", n: 3 },
      { reason: "business_disabled", n: 2 },
      { reason: "phone_limit_day", n: 1 },
      { reason: "unknown", n: 1 },
    ]);
    expect(m.sms.failedReasons30d).toEqual([
      { reason: "4", n: 2 },
      { reason: "715", n: 1 },
    ]);
  });

  it("demo businesses' messages are left out (including the 'demo_business' skips)", async () => {
    const d = emptyData();
    addBusiness(d, "real");
    addBusiness(d, "a1111111-1111-1111-1111-111111111111", { slug: "barber-dan" });
    for (let i = 0; i < 4; i++) addSms(d, "a1111111-1111-1111-1111-111111111111", { status: "skipped", reason: "demo_business", segments: null });
    addSms(d, "real");
    const m = await build(d);
    expect(m.sms.status30d).toMatchObject({ sent: 1, skipped: 0 });
    expect(m.sms.skipReasons30d).toEqual([]);
  });

  it("delivery rate: sent messages with a delivery report; null with no sent message", async () => {
    const d = emptyData();
    addBusiness(d, "a");
    addSms(d, "a", { delivered: true });
    addSms(d, "a", { delivered: true });
    addSms(d, "a", { delivered: true });
    addSms(d, "a", { delivered: false });
    const m = await build(d);
    expect(m.sms.delivery30d).toEqual({ sent: 4, delivered: 3, rate: 75 });
    expect((await build(emptyData())).sms.delivery30d.rate).toBeNull();
  });

  it("segments: the sum over sent messages; a missing count (an old row) is 0", async () => {
    const d = emptyData();
    addBusiness(d, "a");
    addSms(d, "a", { segments: 2 });
    addSms(d, "a", { segments: 3 });
    addSms(d, "a", { segments: null });
    const m = await build(d);
    expect(m.sms.segments).toEqual({ last30d: 5, thisMonth: 5 });
  });

  describe("estimated cost", () => {
    const withSegments = () => {
      const d = emptyData();
      addBusiness(d, "a");
      addSms(d, "a", { segments: 4 });
      addSms(d, "a", { segments: 6 });
      return d;
    };

    it("segments x the price from SMS_SEGMENT_PRICE_AGOROT", async () => {
      const m = await build(withSegments(), { ...ENV_ALL, SMS_SEGMENT_PRICE_AGOROT: "12" });
      expect(m.sms.cost).toEqual({ priceConfigured: true, priceAgorot: 12, last30dAgorot: 120, thisMonthAgorot: 120 });
      expect(m.sms.monthly[5].costAgorot).toBe(120);
    });

    it("without the price: segments only, no invented price", async () => {
      const m = await build(withSegments(), ENV_ALL);
      expect(m.sms.cost).toEqual({ priceConfigured: false, priceAgorot: null, last30dAgorot: null, thisMonthAgorot: null });
      expect(m.sms.monthly.every((x) => x.costAgorot === null)).toBe(true);
      expect(m.sms.segments.last30d).toBe(10);
    });

    it.each(["", "abc", "-5", "1.5", "12 ", "1e3", "9999999", " "])("a price that is not whole agorot (%j) counts as not set", async (raw) => {
      const m = await build(withSegments(), { ...ENV_ALL, SMS_SEGMENT_PRICE_AGOROT: raw });
      if (raw.trim() === "12") return; // "12 " trims to a valid 12
      expect(m.sms.cost.priceConfigured).toBe(false);
    });

    it("parsePriceAgorot", () => {
      expect(parsePriceAgorot("0")).toBe(0);
      expect(parsePriceAgorot(" 25 ")).toBe(25);
      expect(parsePriceAgorot(undefined)).toBeNull();
      expect(parsePriceAgorot("2.5")).toBeNull();
    });
  });
});

describe("the businesses table", () => {
  it("per business: counts for 30 days, the last appointment, demo badge; sorted by appointments", async () => {
    const d = emptyData();
    addBusiness(d, "busy", { name: "עסק עמוס", created: ago(100 * DAY) });
    for (let i = 0; i < 3; i++) addAppointment(d, "busy", { created: ago((i + 1) * DAY) });
    addAppointment(d, "busy", { created: ago(60 * DAY) }); // not in the 30 days
    addSms(d, "busy", { segments: 2 });
    addSms(d, "busy", { segments: 3 });
    addSms(d, "busy", { status: "failed", reason: "4", segments: null });
    addBusiness(d, "quiet", { name: "עסק שקט", created: ago(100 * DAY) });
    const rows = (await build(d)).businesses.rows;
    expect(rows.map((r) => r.name)).toEqual(["עסק עמוס", "עסק שקט"]);
    expect(rows[0]).toMatchObject({ appts30d: 3, smsSent30d: 2, segments30d: 5, smsFailed30d: 1, isDemo: false });
    expect(rows[0].lastAppointmentAt).toBe(ago(1 * DAY));
    expect(rows[1]).toMatchObject({ appts30d: 0, lastAppointmentAt: null });
  });

  it("at most 200 rows, and it says so", async () => {
    const d = emptyData();
    for (let i = 0; i < 250; i++) addBusiness(d, `b${i}`);
    const m = await build(d);
    expect(m.businesses.rows).toHaveLength(200);
    expect(m.businesses.total).toBe(250);
    expect(m.businesses.truncated).toBe(true);
    expect(m.overview.businesses.total).toBe(250);
  });
});

describe("health", () => {
  const withBeat = (minutesAgo: number, ok = true) => {
    const d = emptyData();
    d.heartbeats["sms-outbox"] = { job: "sms-outbox", last_run_at: new Date(NOW.getTime() - minutesAgo * 60_000).toISOString(), ok, detail: null };
    return d;
  };

  it("green when it ran within 15 minutes, red after that, red when it never ran", async () => {
    expect((await build(withBeat(2))).health.cron).toMatchObject({ status: "ok", severity: "ok", minutesAgo: 2 });
    expect((await build(withBeat(15))).health.cron.status).toBe("ok"); // exactly 15 is still fine
    expect((await build(withBeat(16))).health.cron).toMatchObject({ status: "stale", severity: "bad" });
    expect((await build(withBeat(600))).health.cron.severity).toBe("bad");
    expect((await build(emptyData())).health.cron).toMatchObject({ status: "never", severity: "bad", lastRunAt: null });
  });

  it("a run that reported a failure is red too", async () => {
    expect((await build(withBeat(1, false))).health.cron).toMatchObject({ status: "failing", severity: "bad" });
  });

  it("pending messages that are overdue, and failures of the last 24 hours by code", async () => {
    const d = emptyData();
    addBusiness(d, "a");
    addSms(d, "a", { status: "pending", nextAttempt: ago(16 * 60_000) }); // overdue
    addSms(d, "a", { status: "pending", nextAttempt: ago(14 * 60_000) }); // not yet
    addSms(d, "a", { status: "pending", nextAttempt: new Date(NOW.getTime() + 60 * 60_000).toISOString() }); // a retry waiting
    addSms(d, "a", { status: "failed", reason: "4", updated: ago(3 * 3_600_000), segments: null });
    addSms(d, "a", { status: "failed", reason: "4", updated: ago(5 * 3_600_000), segments: null });
    addSms(d, "a", { status: "failed", reason: "715", updated: ago(1 * 3_600_000), segments: null });
    addSms(d, "a", { status: "failed", reason: "4", updated: ago(30 * 3_600_000), segments: null }); // older than a day
    const h = (await build(d)).health;
    expect(h.pendingOverdue).toBe(1);
    expect(h.failed24h).toEqual([
      { code: "4", n: 2 },
      { code: "715", n: 1 },
    ]);
  });

  it("which settings are set: names and yes/no, never the values", async () => {
    const m = await build(emptyData(), { ...ENV_ALL, SMS_019_USERNAME: "", CRON_SECRET: undefined });
    const set = Object.fromEntries(m.health.env.map((e) => [e.name, e.set]));
    expect(set).toEqual({
      SMS_019_API_TOKEN: true,
      SMS_019_USERNAME: false,
      SMS_019_SOURCE: true,
      SMS_019_WEBHOOK_SECRET: true,
      NEXT_PUBLIC_SITE_URL: true,
      CRON_SECRET: false,
    });
    const json = JSON.stringify(m);
    for (const secret of ["secret-token-value", "secret-hook-value", "secret-cron-value", "tornow.example"]) {
      expect(json).not.toContain(secret);
    }
  });

  it("the dry-run setting: a loud flag only for the value that really switches sending off", async () => {
    expect((await build(emptyData(), ENV_ALL)).health.dryRun).toEqual({ set: false, on: false });
    expect((await build(emptyData(), { ...ENV_ALL, SMS_019_DRY_RUN: "1" })).health.dryRun).toEqual({ set: true, on: true });
    expect((await build(emptyData(), { ...ENV_ALL, SMS_019_DRY_RUN: "0" })).health.dryRun).toEqual({ set: true, on: false });
    expect((await build(emptyData(), { ...ENV_ALL, SMS_019_DRY_RUN: "" })).health.dryRun).toEqual({ set: false, on: false });
  });
});

describe("the rest", () => {
  it("revenue is nothing: no numbers", async () => {
    expect((await build(emptyData())).revenue).toBeNull();
  });

  it("an empty system gives zeros, not errors", async () => {
    const m = await build(emptyData());
    expect(m.overview.businesses).toMatchObject({ total: 0, active: 0, dormant: 0 });
    expect(m.sms.daily).toHaveLength(30);
    expect(m.sms.monthly).toHaveLength(6);
    expect(m.businesses.rows).toEqual([]);
    expect(JSON.stringify(m)).not.toMatch(/NaN|Infinity|undefined/);
  });

  it("timestamps are ISO strings and the zone is Israel's", async () => {
    const m = await build(emptyData());
    expect(m.generatedAt).toBe(NOW.toISOString());
    expect(m.timezone).toBe("Asia/Jerusalem");
  });
});
