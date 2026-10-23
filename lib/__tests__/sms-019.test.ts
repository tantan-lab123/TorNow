import { describe, expect, it, vi } from "vitest";
import {
  classifySendStatus,
  maskPhone,
  normalizeIsraeliMobile,
  readSmsConfig,
  sendSms019,
  type SmsConfig,
} from "@/lib/sms/019";

const cfg: SmsConfig = { token: "SECRET-TOKEN", username: "user1", source: "TorNow", dryRun: false };
const reply = (body: unknown, status = 200) =>
  vi.fn().mockResolvedValue(new Response(JSON.stringify(body), { status }));
const input = { id: "r", phone: "501234567", message: "m" };

describe("normalizeIsraeliMobile", () => {
  it.each([
    ["0501234567", "501234567"],
    ["050-123-4567", "501234567"],
    ["+972501234567", "501234567"],
    ["972501234567", "501234567"],
    ["00972 50 123 4567", "501234567"],
    ["501234567", "501234567"],
  ])("%s -> %s", (raw, phone) => {
    expect(normalizeIsraeliMobile(raw)).toEqual({ ok: true, phone });
  });

  it.each(["", null, undefined, "021234567", "0212345678", "+12025550123", "12345", "05012345"])(
    "%s is skipped, not thrown",
    (raw) => {
      expect(normalizeIsraeliMobile(raw as string).ok).toBe(false);
    }
  );

  it("masks all but the last three digits", () => {
    expect(maskPhone("501234567")).toBe("***567");
  });
});

describe("readSmsConfig", () => {
  it("is off without credentials", () => {
    expect(readSmsConfig({})).toEqual({ ok: false, reason: "sms_not_configured" });
  });
  it("rejects a sender that 019 would refuse", () => {
    const env = { SMS_019_API_TOKEN: "t", SMS_019_USERNAME: "u", SMS_019_SOURCE: "Tor Now!" };
    expect(readSmsConfig(env)).toEqual({ ok: false, reason: "sms_source_invalid" });
  });
  it("turns dry run on with 1", () => {
    const env = { SMS_019_API_TOKEN: "t", SMS_019_USERNAME: "u", SMS_019_SOURCE: "TorNow", SMS_019_DRY_RUN: "1" };
    const r = readSmsConfig(env);
    expect(r.ok && r.config.dryRun).toBe(true);
  });
});

describe("classifySendStatus", () => {
  it.each([4, 12, 5, 6, 998, 999])("%i is retryable", (s) => expect(classifySendStatus(s)).toBe("retryable"));
  it.each([8, 9, 715, 989, 992, 515, 1, 2])("%i is permanent", (s) => expect(classifySendStatus(s)).toBe("permanent"));
  it.each([3, 10, 11])("%i is a configuration problem", (s) => expect(classifySendStatus(s)).toBe("config"));
  it("treats an unknown code as retryable (attempts are bounded)", () => {
    expect(classifySendStatus(4242)).toBe("retryable");
  });
});

describe("sendSms019", () => {
  it("posts the documented JSON and reads the shipment id", async () => {
    const fetchImpl = reply({ status: 0, message: "SMS will be sent", shipment_id: "abc123" });
    const r = await sendSms019(cfg, { id: "row-1", phone: "501234567", message: "שלום" }, { fetchImpl });
    expect(r).toEqual({ ok: true, status: 0, shipmentId: "abc123", retryable: false });

    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe("https://019sms.co.il/api");
    expect(init.headers.Authorization).toBe("Bearer SECRET-TOKEN");
    expect(JSON.parse(init.body)).toEqual({
      sms: {
        user: { username: "user1" },
        source: "TorNow",
        destinations: { phone: [{ $: { id: "row-1" }, _: "501234567" }] },
        message: "שלום",
      },
    });
  });

  it("uses /api/test in dry-run mode", async () => {
    const fetchImpl = reply({ status: 0, shipment_id: "x" });
    await sendSms019({ ...cfg, dryRun: true }, input, { fetchImpl });
    expect(fetchImpl.mock.calls[0][0]).toBe("https://019sms.co.il/api/test");
  });

  it("classifies provider errors", async () => {
    const balance = await sendSms019(cfg, input, { fetchImpl: reply({ status: 4, message: "no balance" }) });
    expect(balance).toMatchObject({ ok: false, status: 4, retryable: true, errorClass: "retryable" });
    const blocked = await sendSms019(cfg, input, { fetchImpl: reply({ status: 715 }) });
    expect(blocked).toMatchObject({ ok: false, status: 715, retryable: false, errorClass: "permanent" });
    const token = await sendSms019(cfg, input, { fetchImpl: reply({ status: 11 }) });
    expect(token).toMatchObject({ ok: false, status: 11, errorClass: "config" });
  });

  it("retries on HTTP 5xx and fails permanently on an unreadable 4xx", async () => {
    const down = await sendSms019(cfg, input, { fetchImpl: reply({}, 503) });
    expect(down).toMatchObject({ ok: false, retryable: true });
    const odd = await sendSms019(cfg, input, {
      fetchImpl: vi.fn().mockResolvedValue(new Response("nope", { status: 400 })),
    });
    expect(odd).toMatchObject({ ok: false, retryable: false });
  });

  it("times out as a retryable failure", async () => {
    const fetchImpl = vi.fn(
      (_u: string, init: RequestInit) =>
        new Promise((_res, rej) => {
          init.signal!.addEventListener("abort", () =>
            rej(Object.assign(new Error("aborted"), { name: "AbortError" }))
          );
        })
    );
    const r = await sendSms019(cfg, input, { fetchImpl: fetchImpl as unknown as typeof fetch, timeoutMs: 10 });
    expect(r).toMatchObject({ ok: false, retryable: true, message: "timeout" });
  });

  it("never leaks the token, the phone or the body in the result", async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error("boom SECRET-TOKEN 501234567"));
    const r = await sendSms019(cfg, { ...input, message: "private text" }, { fetchImpl });
    expect(JSON.stringify(r)).not.toMatch(/SECRET-TOKEN|501234567|private text/);
  });
});
