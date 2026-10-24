import { describe, expect, it, vi } from "vitest";
import { enqueueBookedSms, enqueueSms, processSmsRow } from "@/lib/sms/outbox";
import {
  DAY_MS,
  HOUR_MS,
  PHONE_LIMIT_PER_DAY,
  PHONE_LIMIT_PER_HOUR,
  phoneLimitHit,
} from "@/lib/sms/limits";
import { ENV, NOW, appt, biz, ctx, fakeRepo, ok } from "./helpers/sms-fakes";

const PHONE = "0501234567";
const at = (offsetMs: number) => new Date(NOW.getTime() + offsetMs);

/** A repo whose rows are created at a time the test moves. */
function repoWithClock() {
  let t = NOW.getTime();
  const made = fakeRepo(appt(), biz(), () => new Date(t));
  return { ...made, setTime: (ms: number) => (t = ms), advance: (ms: number) => (t += ms) };
}

const enqueue = (repo: ReturnType<typeof fakeRepo>["repo"], n: number, over: { phone?: string; business?: ReturnType<typeof biz> } = {}) =>
  enqueueBookedSms(
    { appointmentId: `a-${n}`, phone: over.phone ?? PHONE, business: over.business ?? biz() },
    repo,
    { env: ENV, now: () => NOW }
  );

describe("the limits themselves", () => {
  it("are 2 per hour and 6 per day, per phone", () => {
    expect(PHONE_LIMIT_PER_HOUR).toBe(2);
    expect(PHONE_LIMIT_PER_DAY).toBe(6);
  });
});

describe("limit per hour", () => {
  it("allows two messages in an hour and skips the third, with the code", async () => {
    const { repo, rows } = fakeRepo();
    const first = await enqueue(repo, 1);
    const second = await enqueue(repo, 2);
    const third = await enqueue(repo, 3);

    expect(first?.status).toBe("pending");
    expect(second?.status).toBe("pending"); // the boundary: the 2nd is still fine
    expect(third?.status).toBe("skipped");
    expect(rows.get(third!.id)).toMatchObject({ status: "skipped", error: "phone_limit_hour" });
  });

  it("the window rolls: messages older than an hour do not count", async () => {
    const { repo, setTime } = repoWithClock();
    setTime(NOW.getTime() - HOUR_MS - 60_000); // 61 minutes ago
    await enqueue(repo, 1);
    await enqueue(repo, 2);
    setTime(NOW.getTime());
    const third = await enqueue(repo, 3);
    expect(third?.status).toBe("pending");
  });

  it("a message exactly at the edge of the hour still counts", async () => {
    const { repo, setTime } = repoWithClock();
    setTime(NOW.getTime() - HOUR_MS); // exactly one hour ago: inside the window
    await enqueue(repo, 1);
    await enqueue(repo, 2);
    setTime(NOW.getTime());
    expect((await enqueue(repo, 3))?.status).toBe("skipped");
  });

  it("another phone has its own budget", async () => {
    const { repo } = fakeRepo();
    await enqueue(repo, 1);
    await enqueue(repo, 2);
    expect((await enqueue(repo, 3, { phone: "0521112222" }))?.status).toBe("pending");
  });

  it("the same number in another format is the same phone", async () => {
    const { repo } = fakeRepo();
    await enqueue(repo, 1, { phone: "0501234567" });
    await enqueue(repo, 2, { phone: "+972501234567" });
    expect((await enqueue(repo, 3, { phone: "050-123-4567" }))?.status).toBe("skipped");
  });
});

describe("limit per day", () => {
  /** n messages spread over the last 24 hours, no two within the same hour */
  async function sendSpread(n: number) {
    const made = repoWithClock();
    for (let i = 0; i < n; i++) {
      made.setTime(NOW.getTime() - DAY_MS + (i + 1) * 3 * HOUR_MS - 10 * 60_000); // 3 hours apart, all inside 24h
      const row = await enqueue(made.repo, i + 1);
      expect(row?.status).toBe("pending");
    }
    made.setTime(NOW.getTime());
    return made;
  }

  it("allows six in 24 hours and skips the seventh, with the code", async () => {
    const made = await sendSpread(5);
    const sixth = await enqueue(made.repo, 6);
    expect(sixth?.status).toBe("pending"); // the boundary: the 6th is still fine
    const seventh = await enqueue(made.repo, 7);
    expect(seventh?.status).toBe("skipped");
    expect(made.rows.get(seventh!.id)).toMatchObject({ error: "phone_limit_day" });
  });

  it("the hour limit is reported first when both are hit", async () => {
    const { repo } = fakeRepo();
    for (let i = 1; i <= 6; i++) await enqueue(repo, i, { phone: "0522223333" });
    const r = await phoneLimitHit(repo, "522223333", NOW);
    expect(r).toBe("phone_limit_hour");
  });
});

describe("what does not use up the budget", () => {
  it("skipped messages do not count", async () => {
    const { repo } = fakeRepo();
    const off = biz({ sms_confirmation_enabled: false });
    for (let i = 1; i <= 5; i++) expect((await enqueue(repo, i, { business: off }))?.status).toBe("skipped");
    expect((await enqueue(repo, 6))?.status).toBe("pending");
    expect((await enqueue(repo, 7))?.status).toBe("pending");
    expect((await enqueue(repo, 8))?.status).toBe("skipped"); // only now the hour budget is used up
  });

  it("a message skipped because of the limit does not count either", async () => {
    const { repo } = repoWithClock();
    await enqueue(repo, 1);
    await enqueue(repo, 2);
    for (let i = 3; i <= 8; i++) await enqueue(repo, i); // all skipped (limit)
    const count = await repo.countRecentByPhone("501234567", new Date(NOW.getTime() - DAY_MS).toISOString());
    expect(count).toBe(2);
  });

  it("failed messages do not count", async () => {
    const { repo, rows } = fakeRepo();
    const a = await enqueue(repo, 1);
    const b = await enqueue(repo, 2);
    rows.get(a!.id)!.status = "failed";
    rows.get(b!.id)!.status = "failed";
    expect((await enqueue(repo, 3))?.status).toBe("pending");
  });

  it("sent messages do count", async () => {
    const { repo, rows } = fakeRepo();
    const a = await enqueue(repo, 1);
    const b = await enqueue(repo, 2);
    rows.get(a!.id)!.status = "sent";
    rows.get(b!.id)!.status = "sent";
    expect((await enqueue(repo, 3))?.status).toBe("skipped");
  });
});

describe("again right before sending", () => {
  it("a message with two others queued ahead of it is skipped, the ones ahead go out", async () => {
    // all three got through the check at queue time (a race); the send step lets the first two go
    const { repo, rows, advance } = repoWithClock();
    const ids: string[] = [];
    for (let i = 1; i <= 3; i++) {
      const row = await repo.insert({ appointmentId: `a-${i}`, kind: "booked", toPhone: "501234567", status: "pending" });
      ids.push(row!.id);
      advance(1000);
    }
    const fetchImpl = ok();
    const results = [];
    for (const id of ids) results.push(await processSmsRow(id, repo, ctx(fetchImpl, at(10_000))));

    expect(results).toEqual(["sent", "sent", "skipped"]);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(rows.get(ids[2])).toMatchObject({ status: "skipped", error: "phone_limit_hour" });
  });

  it("a retry does not count itself", async () => {
    const { repo, rows } = fakeRepo();
    const a = await enqueue(repo, 1);
    const b = await enqueue(repo, 2);
    // the second one is sent: the first is still pending and "ahead" of it
    expect(await processSmsRow(b!.id, repo, ctx(ok()))).toBe("sent");
    expect(await processSmsRow(a!.id, repo, ctx(ok()))).toBe("sent");
    expect(rows.get(a!.id)!.status).toBe("sent");
  });

  it("the skip is logged without the phone number or any text", async () => {
    const { repo } = fakeRepo();
    for (let i = 1; i <= 3; i++) await enqueue(repo, i);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await enqueue(repo, 4);
    const logged = warn.mock.calls.map((c) => c.join(" ")).join("\n");
    warn.mockRestore();
    expect(logged).toContain("phone_limit_hour");
    expect(logged).not.toMatch(/501234567|0501234567|972501234567/);
  });
});

describe("the booking itself", () => {
  it("never fails because of a limit: a hit is just a skipped row", async () => {
    const { repo } = fakeRepo();
    await enqueue(repo, 1);
    await enqueue(repo, 2);
    await expect(enqueue(repo, 3)).resolves.toMatchObject({ status: "skipped" });
  });

  it("never fails when the count itself fails", async () => {
    const { repo } = fakeRepo();
    repo.countRecentByPhone = async () => {
      throw new Error("db down");
    };
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(enqueue(repo, 1)).resolves.toBeNull();
    err.mockRestore();
  });

  it("reminders count against the same budget", async () => {
    const { repo } = fakeRepo();
    const remind = (n: number) =>
      enqueueSms(
        {
          kind: "reminder",
          appointmentId: `r-${n}`,
          phone: PHONE,
          forStartTime: "2026-11-05T13:30:00Z",
          business: biz({ sms_reminder_minutes: 60 }),
        },
        repo,
        { env: ENV, now: () => NOW }
      );
    expect((await remind(1))?.status).toBe("pending");
    expect((await enqueue(repo, 2))?.status).toBe("pending");
    expect((await remind(3))?.status).toBe("skipped");
  });
});
