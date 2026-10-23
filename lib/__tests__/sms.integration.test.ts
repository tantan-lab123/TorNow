import { describe, expect, it, vi } from "vitest";

/**
 * Wiring test: the real database layer (in-memory variant, as in local development), the real
 * queue code and the real token lookup, with a fake 019 instead of the network.
 */

const BIZ = "a1111111-1111-1111-1111-111111111111"; // seeded sample business
const ENV = {
  SMS_019_API_TOKEN: "tok",
  SMS_019_USERNAME: "user",
  SMS_019_SOURCE: "TorNow",
  NEXT_PUBLIC_SITE_URL: "https://tornow.example",
};

async function bookAppointment() {
  const db = await import("@/lib/db");
  const [service] = await db.getServices(BIZ);
  const client = await db.findOrCreateClient(BIZ, {
    phone: "0501234567",
    first_name: "דנה",
    last_name: "כהן",
    auth_provider: "guest",
  });
  const start = new Date(Date.now() + 3 * 24 * 3600 * 1000);
  const end = new Date(start.getTime() + 30 * 60_000);
  return db.createAppointment({
    business_id: BIZ,
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
});
