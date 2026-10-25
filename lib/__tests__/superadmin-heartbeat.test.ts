import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

// The cron route is run for real; only the place the heartbeat is written is replaced, so a failure can be made up.
const { record } = vi.hoisted(() => ({ record: vi.fn() }));
vi.mock("@/lib/superadmin/heartbeat", () => ({ recordHeartbeat: record, memoryHeartbeats: () => ({}) }));

import { POST } from "@/app/api/cron/sms-outbox/route";

const SECRET = "cron-secret-0123456789";
const call = () =>
  POST(new NextRequest("http://localhost/api/cron/sms-outbox", { method: "POST", headers: { authorization: `Bearer ${SECRET}` } }));

beforeEach(() => {
  process.env.CRON_SECRET = SECRET;
  record.mockReset();
  record.mockResolvedValue(undefined);
});

describe("the sms-outbox cron job writes its heartbeat", () => {
  it("at the end of a run: the job name, ok, and a short summary of counts", async () => {
    const res = await call();
    expect(res.status).toBe(200);
    expect(record).toHaveBeenCalledTimes(1);
    const [job, ok, detail] = record.mock.calls[0];
    expect(job).toBe("sms-outbox");
    expect(ok).toBe(true);
    expect(detail).toMatch(/^sent=\d+ retry=\d+ failed=\d+ skipped=\d+ reminders_planned=\d+$/);
  });

  it("not for a call without the secret (it is not a run)", async () => {
    const res = await POST(new NextRequest("http://localhost/api/cron/sms-outbox", { method: "POST" }));
    expect(res.status).toBe(401);
    expect(record).not.toHaveBeenCalled();
  });

  it("a heartbeat that fails (throws) does not break the cron: same 200 and the same answer", async () => {
    const plain = await (await call()).json();
    record.mockReset();
    record.mockRejectedValue(new Error("relation cron_heartbeat does not exist"));
    const res = await call();
    expect(res.status).toBe(200);
    const withFailure = await res.json();
    expect(withFailure).toEqual(plain);
    expect(withFailure.success).toBe(true);
  });

  it("a heartbeat that throws synchronously changes nothing either", async () => {
    record.mockReset();
    record.mockImplementation(() => {
      throw new Error("boom");
    });
    const res = await call();
    expect(res.status).toBe(200);
    expect((await res.json()).success).toBe(true);
  });
});
