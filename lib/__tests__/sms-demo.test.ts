import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { DEMO_BUSINESS_IDS, DEMO_BUSINESS_SLUGS, isDemoBusiness } from "@/lib/demo";
import { enqueueBookedSms, enqueueSms, processSmsRow } from "@/lib/sms/outbox";
import { shouldSendSms, smsBlockReason } from "@/lib/sms/policy";
import type { SmsKind } from "@/lib/sms/outbox";
import { ENV, NOW, appt, biz, ctx, fakeRepo, ok } from "./helpers/sms-fakes";

const DEMO = { id: "a1111111-1111-1111-1111-111111111111", slug: "barber-dan" };
const KINDS: SmsKind[] = ["booked", "reminder", "rescheduled", "cancelled"];
const ALL_ON = { sms_confirmation_enabled: true, sms_reminder_minutes: 60 };

describe("which businesses are demos", () => {
  it("the list", () => {
    expect(DEMO_BUSINESS_SLUGS).toEqual(["barber-dan", "maya-nails", "clinic-rafael"]);
    expect(DEMO_BUSINESS_IDS).toContain("a1111111-1111-1111-1111-111111111111");
    expect(DEMO_BUSINESS_IDS).toContain("b2222222-2222-2222-2222-222222222222");
  });

  it("matches by slug or by one of the known ids", () => {
    for (const slug of DEMO_BUSINESS_SLUGS) expect(isDemoBusiness({ slug })).toBe(true);
    expect(isDemoBusiness({ id: "a1111111-1111-1111-1111-111111111111" })).toBe(true);
    expect(isDemoBusiness({ id: "b2222222-2222-2222-2222-222222222222" })).toBe(true);
    // the slug was renamed: the id still gives it away
    expect(isDemoBusiness({ id: "a1111111-1111-1111-1111-111111111111", slug: "renamed" })).toBe(true);
  });

  it("a normal business is not a demo", () => {
    expect(isDemoBusiness({ id: "biz", slug: "salon-noa" })).toBe(false);
    expect(isDemoBusiness({ id: "c3333333-3333-3333-3333-333333333333" })).toBe(false); // only the slug identifies this one
    expect(isDemoBusiness(null)).toBe(false);
    expect(isDemoBusiness(undefined)).toBe(false);
    expect(isDemoBusiness({})).toBe(false);
  });

  it("is the one list the landing page uses", () => {
    const page = readFileSync("app/page.tsx", "utf8");
    expect(page).toContain('from "@/lib/demo"');
    expect(page).toContain("DEMO_BUSINESS_SLUGS");
    // no second copy of the list
    for (const slug of DEMO_BUSINESS_SLUGS) expect(page).not.toContain(`"${slug}"`);
  });
});

describe("policy: a demo business sends nothing, whatever its settings say", () => {
  it.each(KINDS)("%s", (kind) => {
    expect(shouldSendSms({ ...DEMO, settings: ALL_ON }, kind)).toBe(false);
    expect(smsBlockReason({ ...DEMO, settings: ALL_ON }, kind)).toBe("demo_business");
    expect(smsBlockReason({ ...DEMO, settings: {} }, kind)).toBe("demo_business");
  });

  it("a normal business with the same settings sends", () => {
    expect(shouldSendSms({ id: "biz", slug: "salon", settings: ALL_ON }, "booked")).toBe(true);
    expect(shouldSendSms({ id: "biz", slug: "salon", settings: ALL_ON }, "reminder")).toBe(true);
  });
});

describe("the booking confirmation at a demo business", () => {
  const demo = biz(ALL_ON, { id: DEMO.id, slug: DEMO.slug } as never);

  it("is queued as skipped with demo_business", async () => {
    const { repo, rows } = fakeRepo(appt(), demo);
    const r = await enqueueBookedSms({ appointmentId: "a1", phone: "0501234567", business: demo }, repo, { env: ENV, now: () => NOW });
    expect(r?.status).toBe("skipped");
    expect(rows.get(r!.id)).toMatchObject({ status: "skipped", error: "demo_business" });
  });

  it("the 019 sender is never called, not even for a row that is somehow pending", async () => {
    const { repo, rows } = fakeRepo(appt(), demo);
    const row = await repo.insert({ appointmentId: "a1", kind: "booked", toPhone: "501234567", status: "pending" });
    const fetchImpl = ok();
    expect(await processSmsRow(row!.id, repo, ctx(fetchImpl))).toBe("skipped");
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(rows.get(row!.id)).toMatchObject({ status: "skipped", error: "demo_business" });
  });

  it("the same for a reminder row", async () => {
    const { repo, rows } = fakeRepo(appt(), demo);
    const row = await repo.insert({
      appointmentId: "a1",
      kind: "reminder",
      forStartTime: "2026-11-05T13:30:00Z",
      toPhone: "501234567",
      status: "pending",
    });
    const fetchImpl = ok();
    expect(await processSmsRow(row!.id, repo, ctx(fetchImpl))).toBe("skipped");
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(rows.get(row!.id)!.error).toBe("demo_business");
  });

  it("is recognised by the business row even when the queued data carries no slug", async () => {
    // the send step trusts the database row, not what was passed in when it was queued
    const { repo } = fakeRepo(appt(), demo);
    const row = await repo.insert({ appointmentId: "a1", kind: "booked", toPhone: "501234567", status: "pending" });
    const fetchImpl = ok();
    await processSmsRow(row!.id, repo, ctx(fetchImpl));
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe("a demo booking uses no phone budget", () => {
  it("any number of demo bookings, then two real ones still go through", async () => {
    const { repo } = fakeRepo();
    const demo = { id: DEMO.id, slug: DEMO.slug, settings: ALL_ON };
    for (let i = 1; i <= 8; i++) {
      const r = await enqueueBookedSms({ appointmentId: `d-${i}`, phone: "0501234567", business: demo }, repo, { env: ENV, now: () => NOW });
      expect(r?.status).toBe("skipped");
    }
    const real = (n: number) =>
      enqueueBookedSms({ appointmentId: `r-${n}`, phone: "0501234567", business: biz() }, repo, { env: ENV, now: () => NOW });
    expect((await real(1))?.status).toBe("pending");
    expect((await real(2))?.status).toBe("pending");
    expect((await real(3))?.status).toBe("skipped"); // the budget is only used by real messages
  });
});

describe("a normal business is not affected", () => {
  it("confirmation and reminder both go out", async () => {
    const business = biz(ALL_ON);
    const { repo } = fakeRepo(appt(), business);
    const booked = await enqueueBookedSms({ appointmentId: "a1", phone: "0501234567", business }, repo, { env: ENV, now: () => NOW });
    expect(booked?.status).toBe("pending");
    const reminder = await enqueueSms(
      { kind: "reminder", appointmentId: "a1", phone: "0501234567", forStartTime: "2026-11-05T13:30:00Z", business },
      repo,
      { env: ENV, now: () => NOW }
    );
    expect(reminder?.status).toBe("pending");
  });
});
