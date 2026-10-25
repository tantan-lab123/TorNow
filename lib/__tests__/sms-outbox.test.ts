import { describe, expect, it, vi } from "vitest";
import {
  BACKOFF_MINUTES,
  MAX_ATTEMPTS,
  enqueueBookedSms,
  planAfterFailure,
  processDueSms,
  processSmsRow,
  skipReason,
} from "@/lib/sms/outbox";
import { billedMessages } from "@/lib/sms/message";
import type { Appointment } from "@/lib/types";
import { BIZ_ID, ENV, NOW, appt, biz, ctx, fakeRepo, ok, providerError } from "./helpers/sms-fakes";

describe("enqueueBookedSms", () => {
  it("queues a pending row with the normalized phone", async () => {
    const { repo, rows } = fakeRepo();
    const r = await enqueueBookedSms({ appointmentId: "appt-1", phone: "0501234567" }, repo, { env: ENV });
    expect(r?.status).toBe("pending");
    expect([...rows.values()][0]).toMatchObject({ kind: "booked", to_phone: "501234567", status: "pending" });
  });

  it("records skipped (with the reason) when 019 is not configured: the booking is unaffected", async () => {
    const { repo, rows } = fakeRepo();
    const r = await enqueueBookedSms({ appointmentId: "appt-1", phone: "0501234567" }, repo, { env: {} });
    expect(r?.status).toBe("skipped");
    expect([...rows.values()][0]).toMatchObject({ status: "skipped", error: "sms_not_configured" });
  });

  it("skips an invalid or non-Israeli number and a missing site url", async () => {
    const a = fakeRepo();
    await enqueueBookedSms({ appointmentId: "a1", phone: "0212345678" }, a.repo, { env: ENV });
    expect([...a.rows.values()][0]).toMatchObject({ status: "skipped", error: "phone_not_israeli_mobile" });
    const b = fakeRepo();
    await enqueueBookedSms({ appointmentId: "a2", phone: "0501234567" }, b.repo, { env: { ...ENV, NEXT_PUBLIC_SITE_URL: "" } });
    expect([...b.rows.values()][0]).toMatchObject({ status: "skipped", error: "site_url_missing" });
  });

  it("is idempotent per appointment and kind", async () => {
    const { repo, rows } = fakeRepo();
    await enqueueBookedSms({ appointmentId: "appt-1", phone: "0501234567" }, repo, { env: ENV });
    const again = await enqueueBookedSms({ appointmentId: "appt-1", phone: "0501234567" }, repo, { env: ENV });
    expect(again).toBeNull();
    expect(rows.size).toBe(1);
  });

  it("never throws when the database does", async () => {
    const { repo } = fakeRepo();
    repo.insert = async () => {
      throw new Error("relation sms_outbox does not exist");
    };
    await expect(enqueueBookedSms({ appointmentId: "x", phone: "0501234567" }, repo, { env: ENV })).resolves.toBeNull();
  });
});

describe("processSmsRow state transitions", () => {
  it("pending -> sent, stores the shipment id, sends the id as external_id and a link with a fresh token", async () => {
    const { repo, rows, tokens } = fakeRepo();
    const q = await enqueueBookedSms({ appointmentId: "appt-1", phone: "0501234567" }, repo, { env: ENV });
    const fetchImpl = ok();
    expect(await processSmsRow(q!.id, repo, ctx(fetchImpl))).toBe("sent");

    expect(rows.get(q!.id)).toMatchObject({ status: "sent", shipment: "S1", attempts: 1 });
    const body = JSON.parse(fetchImpl.mock.calls[0][1].body);
    expect(body.sms.destinations.phone[0]).toEqual({ $: { id: q!.id }, _: "501234567" });
    // the default wording: the business has no template of its own
    expect(body.sms.message).toMatch(/^נקבע לך תור לסלון נועה ב-05\/11 בשעה 15:30\.\nלשינוי\/ביטול: https:\/\/tornow\.example\/t\//);
    expect(rows.get(q!.id)!.segments).toBe(2);
    const link = (body.sms.message.match(/https:\/\/\S+$/) as RegExpMatchArray)[0];
    expect(link).toMatch(/^https:\/\/tornow\.example\/t\/[A-Za-z0-9_-]{32}$/);
    // only the hash of that token is stored, valid until the end of the appointment
    expect(tokens).toHaveLength(1);
    expect(tokens[0].expires).toBe("2026-11-05T14:15:00Z");
    expect(tokens[0].hash).not.toContain(link.split("/t/")[1]);
  });

  it("a retryable failure backs off 1, 5, 15, 60, 180 minutes, with a NEW token each time, then ends failed", async () => {
    const { repo, rows, tokens } = fakeRepo();
    const q = await enqueueBookedSms({ appointmentId: "appt-1", phone: "0501234567" }, repo, { env: ENV });
    let now = NOW;
    const fetchImpl = providerError(4); // no balance
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      const outcome = await processSmsRow(q!.id, repo, ctx(fetchImpl, now));
      const row = rows.get(q!.id)!;
      if (attempt < MAX_ATTEMPTS) {
        expect(outcome).toBe("retry");
        expect(row.status).toBe("pending");
        expect(new Date(row.next_attempt_at).getTime() - now.getTime()).toBe(BACKOFF_MINUTES[attempt - 1] * 60_000);
        // not due before the backoff has passed
        expect(await processSmsRow(q!.id, repo, ctx(fetchImpl, new Date(now.getTime() + 30_000)))).toBe("busy");
        now = new Date(row.next_attempt_at);
      } else {
        expect(outcome).toBe("failed");
        expect(row.status).toBe("failed");
      }
    }
    expect(rows.get(q!.id)).toMatchObject({ attempts: MAX_ATTEMPTS, error: "4" });
    expect(new Set(tokens.map((t) => t.hash)).size).toBe(MAX_ATTEMPTS);
  });

  it("a permanent failure (blocked number) is failed at once", async () => {
    const { repo, rows } = fakeRepo();
    const q = await enqueueBookedSms({ appointmentId: "appt-1", phone: "0501234567" }, repo, { env: ENV });
    expect(await processSmsRow(q!.id, repo, ctx(providerError(715)))).toBe("failed");
    expect(rows.get(q!.id)).toMatchObject({ status: "failed", attempts: 1, error: "715" });
  });

  it("logs a token problem loudly and keeps the message for a retry", async () => {
    const { repo, rows } = fakeRepo();
    const q = await enqueueBookedSms({ appointmentId: "appt-1", phone: "0501234567" }, repo, { env: ENV });
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await processSmsRow(q!.id, repo, ctx(providerError(11)))).toBe("retry");
    expect(err).toHaveBeenCalledWith(expect.stringContaining("configuration problem"));
    err.mockRestore();
    expect(rows.get(q!.id)!.status).toBe("pending");
  });

  it("skips a cancelled or past appointment without calling the provider", async () => {
    for (const a of [appt({ status: "cancelled" }), appt({ start_time: "2026-10-30T10:00:00Z" }), null]) {
      const { repo, rows } = fakeRepo(a);
      const q = await enqueueBookedSms({ appointmentId: "appt-1", phone: "0501234567" }, repo, { env: ENV });
      const fetchImpl = ok();
      expect(await processSmsRow(q!.id, repo, ctx(fetchImpl))).toBe("skipped");
      expect(fetchImpl).not.toHaveBeenCalled();
      expect(rows.get(q!.id)!.status).toBe("skipped");
    }
    expect(skipReason(appt(), NOW)).toBeNull();
  });

  it("two racing workers send exactly once", async () => {
    const { repo } = fakeRepo();
    const q = await enqueueBookedSms({ appointmentId: "appt-1", phone: "0501234567" }, repo, { env: ENV });
    const fetchImpl = ok();
    const results = await Promise.all([
      processSmsRow(q!.id, repo, ctx(fetchImpl)),
      processSmsRow(q!.id, repo, ctx(fetchImpl)),
    ]);
    expect(results.sort()).toEqual(["busy", "sent"]);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("a crash after the claim counts as an attempt and leaves the row for the cron job", async () => {
    const { repo, rows } = fakeRepo();
    repo.getAppointment = async () => {
      throw new Error("db down");
    };
    const q = await enqueueBookedSms({ appointmentId: "appt-1", phone: "0501234567" }, repo, { env: ENV });
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await processSmsRow(q!.id, repo, ctx(ok()))).toBe("retry");
    err.mockRestore();
    expect(rows.get(q!.id)).toMatchObject({ status: "pending", attempts: 1, error: "internal" });
  });
});

describe("planAfterFailure / processDueSms", () => {
  it("only retryable failures with attempts left stay pending", () => {
    expect(planAfterFailure({ retryable: true }, 1, NOW).status).toBe("pending");
    expect(planAfterFailure({ retryable: true }, MAX_ATTEMPTS, NOW).status).toBe("failed");
    expect(planAfterFailure({ retryable: false }, 1, NOW).status).toBe("failed");
  });

  it("the cron pass sends what is due and leaves the rest", async () => {
    const { repo, rows } = fakeRepo();
    const a = await enqueueBookedSms({ appointmentId: "appt-1", phone: "0501234567" }, repo, { env: ENV });
    const b = await enqueueBookedSms({ appointmentId: "appt-2", phone: "0521234567" }, repo, { env: ENV });
    rows.get(b!.id)!.next_attempt_at = "2026-11-01T09:00:00Z"; // later
    const res = await processDueSms(repo, { limit: 10 }, ctx(ok()));
    expect(res).toMatchObject({ processed: 1, sent: 1 });
    expect(rows.get(a!.id)!.status).toBe("sent");
    expect(rows.get(b!.id)!.status).toBe("pending");
  });
});

describe("the business's own settings", () => {
  const sentMessage = (fetchImpl: ReturnType<typeof vi.fn>) =>
    JSON.parse(fetchImpl.mock.calls[0][1].body).sms.message as string;

  it("the enqueue remembers the business (usage per business)", async () => {
    const { repo, rows } = fakeRepo();
    await enqueueBookedSms({ appointmentId: "appt-1", phone: "0501234567", business: biz() }, repo, { env: ENV });
    expect([...rows.values()][0].business_id).toBe(BIZ_ID);
  });

  it("switched off at enqueue time: a skipped row with the reason, nothing is sent", async () => {
    const { repo, rows } = fakeRepo();
    const off = biz({ sms_confirmation_enabled: false });
    const r = await enqueueBookedSms({ appointmentId: "appt-1", phone: "0501234567", business: off }, repo, { env: ENV });
    expect(r?.status).toBe("skipped");
    expect([...rows.values()][0]).toMatchObject({ status: "skipped", error: "business_disabled", business_id: BIZ_ID });
  });

  it("a missing switch means send", async () => {
    const { repo } = fakeRepo();
    const r = await enqueueBookedSms({ appointmentId: "appt-1", phone: "0501234567", business: biz({}) }, repo, { env: ENV });
    expect(r?.status).toBe("pending");
  });

  it("switched off between the enqueue and a retry: the retry sends nothing", async () => {
    // the owner's settings are read again before every attempt
    let current = biz();
    const { repo, rows } = fakeRepo();
    repo.getBusiness = async () => current;
    const q = await enqueueBookedSms({ appointmentId: "appt-1", phone: "0501234567", business: current }, repo, { env: ENV });
    const failing = providerError(4);
    expect(await processSmsRow(q!.id, repo, ctx(failing))).toBe("retry");
    expect(failing).toHaveBeenCalledTimes(1);

    current = biz({ sms_confirmation_enabled: false }); // the owner switches it off
    const due = new Date(rows.get(q!.id)!.next_attempt_at);
    const second = ok();
    expect(await processSmsRow(q!.id, repo, ctx(second, due))).toBe("skipped");
    expect(second).not.toHaveBeenCalled();
    expect(rows.get(q!.id)).toMatchObject({ status: "skipped", error: "business_disabled" });
  });

  it("uses the settings from the business row, not the appointment's embedded business (which has no settings)", async () => {
    const { repo } = fakeRepo(appt({ business: { name: "x" } as Appointment["business"] }), biz({ sms_confirmation_enabled: false }));
    const q = await enqueueBookedSms({ appointmentId: "appt-1", phone: "0501234567", business: biz() }, repo, { env: ENV });
    const fetchImpl = ok();
    expect(await processSmsRow(q!.id, repo, ctx(fetchImpl))).toBe("skipped");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("sends the business's own wording", async () => {
    const { repo } = fakeRepo(appt(), biz({ sms_confirmation_template: "שלום {name}, תור ב-{date} ב-{time} ל{service}. {link}" }));
    const q = await enqueueBookedSms({ appointmentId: "appt-1", phone: "0501234567", business: biz() }, repo, { env: ENV });
    const fetchImpl = ok();
    expect(await processSmsRow(q!.id, repo, ctx(fetchImpl))).toBe("sent");
    expect(sentMessage(fetchImpl)).toMatch(/^שלום דנה, תור ב-05\/11 ב-15:30 לתספורת\. https:\/\/tornow\.example\/t\/[A-Za-z0-9_-]{32}$/);
  });

  it("a wording without {link} still gets the manage link at the end", async () => {
    const { repo } = fakeRepo(appt(), biz({ sms_confirmation_template: "תור ב-{date}" }));
    const q = await enqueueBookedSms({ appointmentId: "appt-1", phone: "0501234567", business: biz() }, repo, { env: ENV });
    const fetchImpl = ok();
    await processSmsRow(q!.id, repo, ctx(fetchImpl));
    expect(sentMessage(fetchImpl)).toMatch(/^תור ב-05\/11\nhttps:\/\/tornow\.example\/t\/[A-Za-z0-9_-]{32}$/);
  });

  it("a broken saved wording never fails the message: the default goes out, the warning has no customer data", async () => {
    const { repo, rows } = fakeRepo(appt(), biz({ sms_confirmation_template: "מבצע https://evil.test {link}" }));
    const q = await enqueueBookedSms({ appointmentId: "appt-1", phone: "0501234567", business: biz() }, repo, { env: ENV });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const fetchImpl = ok();
    expect(await processSmsRow(q!.id, repo, ctx(fetchImpl))).toBe("sent");
    expect(sentMessage(fetchImpl)).toMatch(/^נקבע לך תור לסלון נועה ב-05\/11 בשעה 15:30\./);
    expect(sentMessage(fetchImpl)).not.toContain("evil");
    const logged = warn.mock.calls.map((c) => String(c[0])).join("\n");
    warn.mockRestore();
    expect(logged).toContain("default wording used");
    expect(logged).not.toMatch(/דנה|0501234567|501234567|tornow\.example\/t\//);
    expect(rows.get(q!.id)!.status).toBe("sent");
  });

  it("records the segments of the message that went out", async () => {
    const { repo, rows } = fakeRepo(appt(), biz({ sms_confirmation_template: "א".repeat(150) + " {link}" }));
    const q = await enqueueBookedSms({ appointmentId: "appt-1", phone: "0501234567", business: biz() }, repo, { env: ENV });
    await processSmsRow(q!.id, repo, ctx(ok()));
    // 150 + space + 66-character link = 217 units -> 4 segments
    expect(rows.get(q!.id)!.segments).toBe(4);
  });

  it("records the billed messages of the exact text that was sent, in the same finish as the segments", async () => {
    const { repo, rows } = fakeRepo(appt(), biz({ sms_confirmation_template: "א".repeat(150) + " {link}" }));
    const q = await enqueueBookedSms({ appointmentId: "appt-1", phone: "0501234567", business: biz() }, repo, { env: ENV });
    const finish = vi.spyOn(repo, "finish");
    const fetchImpl = ok();
    await processSmsRow(q!.id, repo, ctx(fetchImpl));
    // 150 + space + 57-character test link (https://tornow.example/t/<32>) = 208 characters -> 2 billed messages (and 4 carrier segments)
    expect(sentMessage(fetchImpl)).toHaveLength(208);
    expect(rows.get(q!.id)!.billed_messages).toBe(2);
    expect(rows.get(q!.id)!.billed_messages).toBe(billedMessages(sentMessage(fetchImpl)));
    expect(rows.get(q!.id)!.segments).toBe(4);
    const sentCalls = finish.mock.calls.filter(([, patch]) => patch.status === "sent");
    expect(sentCalls).toHaveLength(1);
    expect(sentCalls[0][1]).toMatchObject({ segments: 4, billedMessages: 2 });
  });

  it("the default confirmation is one billed message", async () => {
    const { repo, rows } = fakeRepo();
    const q = await enqueueBookedSms({ appointmentId: "appt-1", phone: "0501234567", business: biz() }, repo, { env: ENV });
    await processSmsRow(q!.id, repo, ctx(ok()));
    expect(rows.get(q!.id)!.billed_messages).toBe(1);
  });

  it("a message that was not sent has no billed number", async () => {
    const { repo, rows } = fakeRepo(appt(), biz({ sms_confirmation_enabled: false }));
    const q = await enqueueBookedSms({ appointmentId: "appt-1", phone: "0501234567", business: biz() }, repo, { env: ENV });
    await processSmsRow(q!.id, repo, ctx(ok()));
    expect(rows.get(q!.id)!.status).toBe("skipped");
    expect(rows.get(q!.id)!.billed_messages).toBeUndefined();
  });

  it("a failed send has no billed number either", async () => {
    const { repo, rows } = fakeRepo();
    const q = await enqueueBookedSms({ appointmentId: "appt-1", phone: "0501234567", business: biz() }, repo, { env: ENV });
    await processSmsRow(q!.id, repo, ctx(providerError(4)));
    expect(rows.get(q!.id)!.billed_messages).toBeUndefined();
  });
});
