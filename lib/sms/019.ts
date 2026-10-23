/**
 * 019sms client: phone normalization, error classification and the HTTP call.
 * Docs: https://docs.019sms.co.il/sms/
 *
 * Nothing here logs the token, the request body or a full phone number.
 */

const API_URL = "https://019sms.co.il/api";
const API_TEST_URL = "https://019sms.co.il/api/test";
const TIMEOUT_MS = 10_000;

// ------------------------------------------------------------------ config

export interface SmsConfig {
  token: string;
  username: string;
  /** Sender name: up to 11 English letters / digits, verified in the 019 account. */
  source: string;
  dryRun: boolean;
}

export type SmsConfigResult = { ok: true; config: SmsConfig } | { ok: false; reason: string };

/** Reads the 019 settings. A missing or invalid one is a reason to skip, never an exception. */
export function readSmsConfig(env: Record<string, string | undefined> = process.env): SmsConfigResult {
  const token = env.SMS_019_API_TOKEN?.trim();
  const username = env.SMS_019_USERNAME?.trim();
  const source = env.SMS_019_SOURCE?.trim();
  if (!token || !username || !source) return { ok: false, reason: "sms_not_configured" };
  if (!/^[A-Za-z0-9]{1,11}$/.test(source)) return { ok: false, reason: "sms_source_invalid" };
  return { ok: true, config: { token, username, source, dryRun: env.SMS_019_DRY_RUN === "1" } };
}

// ------------------------------------------------------------------ phone

export type PhoneResult = { ok: true; phone: string } | { ok: false; reason: string };

/**
 * Israeli mobile number -> "5xxxxxxxx" (the form 019 wants).
 * Accepts 05x..., +9725x..., 9725x... (spaces, dashes and brackets are ignored).
 */
export function normalizeIsraeliMobile(raw: string | null | undefined): PhoneResult {
  let digits = (raw ?? "").replace(/\D/g, "");
  if (!digits) return { ok: false, reason: "phone_missing" };
  if (digits.startsWith("00")) digits = digits.slice(2);
  if (digits.startsWith("972")) digits = digits.slice(3);
  else if (digits.startsWith("0")) digits = digits.slice(1);
  else if (digits.length !== 9) return { ok: false, reason: "phone_not_israeli" };
  if (!/^5\d{8}$/.test(digits)) return { ok: false, reason: "phone_not_israeli_mobile" };
  return { ok: true, phone: digits };
}

/** Last three digits only, for logs. */
export function maskPhone(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  return digits.length > 3 ? `***${digits.slice(-3)}` : "***";
}

// ------------------------------------------------------------------ errors

export type ErrorClass = "retryable" | "permanent" | "config";

const RETRYABLE = new Set([4, 12, 5, 6, 998, 999]); // balance, no send permission right now, provider trouble
const PERMANENT = new Set([1, 2, 8, 9, 715, 989, 992, 515]); // bad request, blocked/invalid number, bad text or sender
const CONFIG = new Set([3, 10, 11]); // token problems: somebody has to fix the settings

/**
 * Unknown codes are treated as retryable: the attempt count is bounded, and a
 * confirmation SMS is worth another try more than a silent loss.
 */
export function classifySendStatus(status: number): ErrorClass {
  if (CONFIG.has(status)) return "config";
  if (PERMANENT.has(status)) return "permanent";
  if (RETRYABLE.has(status)) return "retryable";
  return "retryable";
}

// ------------------------------------------------------------------ send

export interface SendResult {
  ok: boolean;
  /** 019 status code, or null when there was no usable answer (timeout, network, HTTP error). */
  status: number | null;
  shipmentId?: string;
  retryable: boolean;
  errorClass?: ErrorClass;
  message?: string;
}

export interface SendInput {
  /** The outbox row id: 019 returns it as external_id in the delivery report. */
  id: string;
  /** Normalized, 5xxxxxxxx */
  phone: string;
  message: string;
}

export interface SendDeps {
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

function fail(errorClass: ErrorClass, status: number | null, message: string): SendResult {
  return { ok: false, status, retryable: errorClass !== "permanent", errorClass, message };
}

export async function sendSms019(
  config: SmsConfig,
  input: SendInput,
  deps: SendDeps = {}
): Promise<SendResult> {
  const doFetch = deps.fetchImpl ?? fetch;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), deps.timeoutMs ?? TIMEOUT_MS);

  const body = {
    sms: {
      user: { username: config.username },
      source: config.source,
      destinations: { phone: [{ $: { id: input.id }, _: input.phone }] },
      message: input.message,
    },
  };

  try {
    const res = await doFetch(config.dryRun ? API_TEST_URL : API_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: controller.signal,
      cache: "no-store",
    });

    if (res.status === 401 || res.status === 403) return fail("config", null, `http_${res.status}`);
    if (res.status >= 500) return fail("retryable", null, `http_${res.status}`);

    let json: { status?: unknown; message?: unknown; shipment_id?: unknown } | null = null;
    try {
      json = await res.json();
    } catch {
      json = null;
    }
    const status = typeof json?.status === "number" ? json.status : Number(json?.status);
    if (!json || !Number.isInteger(status)) {
      return fail(res.ok ? "retryable" : "permanent", null, `http_${res.status}_unreadable`);
    }

    if (status === 0) {
      return {
        ok: true,
        status: 0,
        shipmentId: json.shipment_id != null ? String(json.shipment_id) : undefined,
        retryable: false,
      };
    }
    const errorClass = classifySendStatus(status);
    return fail(errorClass, status, typeof json.message === "string" ? json.message.slice(0, 200) : `status_${status}`);
  } catch (err) {
    // Only the error kind is reported: never the request, the URL options or the token.
    const aborted = err instanceof Error && err.name === "AbortError";
    return fail("retryable", null, aborted ? "timeout" : "network_error");
  } finally {
    clearTimeout(timer);
  }
}
