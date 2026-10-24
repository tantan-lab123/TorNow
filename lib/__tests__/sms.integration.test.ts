import { beforeAll, describe, expect, it, vi } from "vitest";

/**
 * Wiring test: the real database layer (in-memory variant, as in local development), the real
 * queue code and the real token lookup, with a fake 019 instead of the network.
 */

// A real (non-demo) business created for the test: the seeded sample businesses are demos and never send.
let BIZ = "";
const DEMO_BIZ = "a1111111-1111-1111-1111-111111111111"; // barber-dan, a demo business
const ENV = {
  SMS_019_API_TOKEN: "tok",
  SMS_019_USERNAME: "user",
  SMS_019_SOURCE: "TorNow",
  NEXT_PUBLIC_SITE_URL: "https://tornow.example",
};

beforeAll(async () => {
  const db = await import("@/lib/db");
  const business = await db.createBusiness({ name: "סלון בדיקה", slug: "test-salon", owner_phone: "0529990000" });
  BIZ = business.id;
  await db.createService({ business_id: BIZ, name: "תספורת", duration_minutes: 30, buffer_minutes: 0, price: 80 });
});

async function bookAppointment(businessId: string = BIZ, phone = "0501234567") {
  const db = await import("@/lib/db");
  const [service] = await db.getServices(businessId);
  const client = await db.findOrCreateClient(businessId, {
    phone,
    first_name: "דנה",
    last_name: "כהן",
    auth_provider: "guest",
  });
  const start = new Date(Date.now() + 3 * 24 * 3600 * 1000);
  const end = new Date(start.getTime() + 30 * 60_000);
  return db.createAppointment({
    business_id: businessId,
    service_id: service.id,
    client_id: client.id,
    start_time: start.toISOString(),
    end_time: end.toISOString(),
  });
}

const reply = (body: unknown) => vi.fn().mockImplementation(async () => new Response(JSON.stringify(body)));
const tokenFrom = (fetchImpl: ReturnType<typeof vi.fn>, call = 0) => {
  const message: string = JSON.parse(fetchImpl.mock.calls[call][1].body).sms.message;
  return message.split("/t/")[1];
};

describe("sms confirmation, end to end (in-memory db + fake 019)", () => {
  it("sends once, the link opens the appointment, a resend rotates the token", async () => {
    const { smsRepo, findSmsByTokenHash } = await import("@/lib/db/sms");
    const { enqueueBookedSms, processSmsRow } = await import("@/lib/sms/outbox");
    const { resolveManageToken } = await import("@/lib/sms/manage");
    const { hashManageToken } = await import("@/lib/sms/manage-token");

    const appt = await bookAppointment();
    const queued = await enqueueBookedSms({ appointmentId: appt.id, phone: "0501234567" }, smsRepo, { env: ENV });
    expect(queued?.status).toBe("pending");
    // one SMS per appointment and kind
    expect(await enqueueBookedSms({ appointmentId: appt.id, phone: "0501234567" }, smsRepo, { env: ENV })).toBeNull();

    // attempt 1: 019 has no balance -> retry later; the token it carried is already stored
    const failing = reply({ status: 4, message: "no balance" });
    expect(await processSmsRow(queued!.id, smsRepo, { env: ENV, send: { fetchImpl: failing as unknown as typeof fetch } })).toBe("retry");
    const firstToken = tokenFrom(failing);
    expect((await resolveManageToken(firstToken))?.id).toBe(appt.id);

    // attempt 2 (when due): succeeds with a NEW token; the one from the failed attempt is gone
    const later = new Date(Date.now() + 2 * 60_000);
    const working = reply({ status: 0, shipment_id: "SHIP-1" });
    expect(
      await processSmsRow(queued!.id, smsRepo, { env: ENV, now: () => later, send: { fetchImpl: working as unknown as typeof fetch } })
    ).toBe("sent");
    const secondToken = tokenFrom(working);
    expect(secondToken).not.toBe(firstToken);
    expect(await resolveManageToken(firstToken)).toBeNull();
    expect((await resolveManageToken(secondToken))?.id).toBe(appt.id);

    // the raw token is not what is stored
    expect(await findSmsByTokenHash(secondToken)).toBeNull();
    expect((await findSmsByTokenHash(hashManageToken(secondToken)))?.appointmentId).toBe(appt.id);
  });

  it("wrong, malformed and expired links all resolve to nothing", async () => {
    const { smsRepo, extendSmsManageTokens } = await import("@/lib/db/sms");
    const { enqueueBookedSms, processSmsRow } = await import("@/lib/sms/outbox");
    const { resolveManageToken } = await import("@/lib/sms/manage");

    const appt = await bookAppointment();
    const q = await enqueueBookedSms({ appointmentId: appt.id, phone: "0501234567" }, smsRepo, { env: ENV });
    const fetchImpl = reply({ status: 0, shipment_id: "S" });
    await processSmsRow(q!.id, smsRepo, { env: ENV, send: { fetchImpl: fetchImpl as unknown as typeof fetch } });
    const token = tokenFrom(fetchImpl);

    expect(await resolveManageToken("x".repeat(32))).toBeNull();
    expect(await resolveManageToken("short")).toBeNull();
    expect(await resolveManageToken(undefined)).toBeNull();
    expect(await resolveManageToken(token)).not.toBeNull();

    // the appointment ended: the link is dead
    await extendSmsManageTokens(appt.id, new Date(Date.now() - 1000).toISOString());
    expect(await resolveManageToken(token)).toBeNull();
    // moved to a later time: alive again
    await extendSmsManageTokens(appt.id, new Date(Date.now() + 3600_000).toISOString());
    expect(await resolveManageToken(token)).not.toBeNull();
  });

  it("delivery reports are idempotent, ignore unknown rows and never undo a delivery", async () => {
    const { smsRepo } = await import("@/lib/db/sms");
    const { enqueueBookedSms } = await import("@/lib/sms/outbox");
    const { handleDeliveryReport } = await import("@/lib/sms/service");

    const appt = await bookAppointment();
    const q = await enqueueBookedSms({ appointmentId: appt.id, phone: "0501234567" }, smsRepo, { env: ENV });
    const report = (status: string) => handleDeliveryReport({ externalId: q!.id, status, date: "05/11/26 15:30" });

    expect(await report("-1")).toBe("updated");
    expect(await report("0")).toBe("updated");
    expect(await report("0")).toBe("ignored"); // same report again
    expect(await report("14")).toBe("ignored"); // late failure after delivery
    expect(await handleDeliveryReport({ externalId: "00000000-0000-0000-0000-000000000000", status: "0", date: "" })).toBe("ignored");
    expect(await handleDeliveryReport({ externalId: "not-an-id", status: "0", date: "" })).toBe("ignored");
    expect(await handleDeliveryReport({ externalId: q!.id, status: "junk", date: "" })).toBe("ignored");
  });

  it("a custom wording and the on/off switch of the business, with usage counted per business", async () => {
    const db = await import("@/lib/db");
    const { smsRepo, getSmsUsage } = await import("@/lib/db/sms");
    const { enqueueBookedSms, processSmsRow } = await import("@/lib/sms/outbox");

    const business = (await db.getBusinessById(BIZ))!;
    const usageBefore = await getSmsUsage(BIZ);

    // 1) the owner saved their own wording
    await db.updateBusiness(BIZ, {
      settings: { ...business.settings, sms_confirmation_template: "היי {name}, ב-{date} ב-{time} ל{service}. {link}" },
    });
    const withTemplate = (await db.getBusinessById(BIZ))!;
    const appt = await bookAppointment(BIZ, "0521112233");
    const q = await enqueueBookedSms(
      { appointmentId: appt.id, phone: "0521112233", business: withTemplate },
      smsRepo,
      { env: ENV }
    );
    const fetchImpl = reply({ status: 0, shipment_id: "S-1" });
    expect(await processSmsRow(q!.id, smsRepo, { env: ENV, send: { fetchImpl: fetchImpl as unknown as typeof fetch } })).toBe("sent");
    const message: string = JSON.parse(fetchImpl.mock.calls[0][1].body).sms.message;
    expect(message).toMatch(/^היי (?:דנה|יוסי), ב-\d\d\/\d\d ב-\d\d:\d\d ל.+\. https:\/\/tornow\.example\/t\/[A-Za-z0-9_-]{32}$/);

    // 2) it counts for this business
    const usageAfter = await getSmsUsage(BIZ);
    expect(usageAfter.sent - usageBefore.sent).toBe(1);
    expect(usageAfter.segments - usageBefore.segments).toBeGreaterThanOrEqual(1);

    // 3) the owner switches the SMS off: the next booking is skipped, nothing is sent, nothing is counted
    await db.updateBusiness(BIZ, { settings: { ...withTemplate.settings, sms_confirmation_enabled: false } });
    const off = (await db.getBusinessById(BIZ))!;
    const appt2 = await bookAppointment(BIZ, "0521112244");
    const skipped = await enqueueBookedSms({ appointmentId: appt2.id, phone: "0521112244", business: off }, smsRepo, { env: ENV });
    expect(skipped?.status).toBe("skipped");
    expect((await getSmsUsage(BIZ)).sent).toBe(usageAfter.sent);
  });

  it("a demo business never sends: not at booking, not even for a row that already exists", async () => {
    const { smsRepo } = await import("@/lib/db/sms");
    const { enqueueBookedSms, processSmsRow } = await import("@/lib/sms/outbox");
    const db = await import("@/lib/db");

    const demo = (await db.getBusinessById(DEMO_BIZ))!;
    expect(demo.slug).toBe("barber-dan");
    const appt = await bookAppointment(DEMO_BIZ);

    // booking: queued as skipped / demo_business
    const fetchImpl = reply({ status: 0, shipment_id: "S" });
    const queued = await enqueueBookedSms({ appointmentId: appt.id, phone: "0501234567", business: demo }, smsRepo, { env: ENV });
    expect(queued?.status).toBe("skipped");

    // a row that is somehow pending anyway (inserted by hand): the send step refuses it
    const appt2 = await bookAppointment(DEMO_BIZ);
    const row = await smsRepo.insert({
      appointmentId: appt2.id,
      businessId: DEMO_BIZ,
      kind: "booked",
      toPhone: "501234567",
      status: "pending",
    });
    const outcome = await processSmsRow(row!.id, smsRepo, { env: ENV, send: { fetchImpl: fetchImpl as unknown as typeof fetch } });
    expect(outcome).toBe("skipped");
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
