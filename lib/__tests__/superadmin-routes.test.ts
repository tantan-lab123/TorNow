import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, type NextResponse } from "next/server";

// Only the Google check is replaced (it would call Supabase); everything else in lib/auth stays real.
const { verifyGoogle } = vi.hoisted(() => ({ verifyGoogle: vi.fn() }));
vi.mock("@/lib/auth", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/auth")>();
  return { ...real, verifyGoogleAccessToken: verifyGoogle };
});

import { GET as metricsGET } from "@/app/api/superadmin/metrics/route";
import { POST as logoutPOST } from "@/app/api/superadmin/logout/route";
import { POST as sessionPOST } from "@/app/api/superadmin/session/route";
import { createSuperadminToken, verifySuperadminToken } from "@/lib/superadmin/auth";
import { keyedHash, toAccessRow, type AccessRow } from "@/lib/superadmin/access-log";
import { SUPERADMIN_COOKIE } from "@/lib/superadmin/config";
import { createSessionToken } from "@/lib/auth";

const ALLOWED = "boss@example.com";
const TOKEN = "google-access-token-0123456789-abcdefghij";
const original = process.env.SUPERADMIN_EMAILS;

let ipCounter = 0;
/** A fresh IP per test: the rate limit is counted per address. */
const freshIp = () => `203.0.113.${(ipCounter = (ipCounter % 250) + 1)}`;

function sessionRequest(body: unknown, ip: string = freshIp()) {
  return new NextRequest("http://localhost/api/superadmin/session", {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": ip },
    body: JSON.stringify(body),
  });
}
const withCookie = (path: string, cookie: string, method = "GET") =>
  new NextRequest(`http://localhost${path}`, { method, headers: { cookie } });

const accessLog = () => (globalThis.__ADMIN_ACCESS_LOG__ ??= []);

beforeEach(() => {
  process.env.SUPERADMIN_EMAILS = ALLOWED;
  verifyGoogle.mockReset();
  accessLog().length = 0;
});
afterEach(() => {
  if (original === undefined) delete process.env.SUPERADMIN_EMAILS;
  else process.env.SUPERADMIN_EMAILS = original;
});

/** Every key in a JSON value (objects at any depth). */
function allKeys(value: unknown, into: string[] = []): string[] {
  if (Array.isArray(value)) value.forEach((v) => allKeys(v, into));
  else if (value && typeof value === "object") {
    for (const [k, v] of Object.entries(value)) {
      into.push(k);
      allKeys(v, into);
    }
  }
  return into;
}
const PII_KEY = /phone|email|password|token|message|first_name|last_name|firstname|lastname|passwd|secret/i;

describe("POST /api/superadmin/session", () => {
  it("a token that does not check out: 401 with the generic answer", async () => {
    verifyGoogle.mockResolvedValue(null);
    const res = await sessionPOST(sessionRequest({ access_token: TOKEN }));
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "לא ניתן להתחבר" });
    expect(res.headers.get("set-cookie")).toBeNull();
    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  it("a real Google account that is not on the list: the SAME answer, byte for byte", async () => {
    verifyGoogle.mockResolvedValueOnce(null);
    const bad = await sessionPOST(sessionRequest({ access_token: TOKEN }));
    verifyGoogle.mockResolvedValueOnce({ email: "stranger@example.com", id: "u1" });
    const notAllowed = await sessionPOST(sessionRequest({ access_token: TOKEN }));
    expect(notAllowed.status).toBe(bad.status);
    expect(await notAllowed.text()).toBe(await bad.text());
    expect(notAllowed.headers.get("set-cookie")).toBeNull();
  });

  it("with an empty or missing SUPERADMIN_EMAILS even the right account is refused", async () => {
    verifyGoogle.mockResolvedValue({ email: ALLOWED, id: "u1" });
    for (const value of ["", "  "]) {
      process.env.SUPERADMIN_EMAILS = value;
      const res = await sessionPOST(sessionRequest({ access_token: TOKEN }));
      expect(res.status).toBe(401);
    }
    delete process.env.SUPERADMIN_EMAILS;
    expect((await sessionPOST(sessionRequest({ access_token: TOKEN }))).status).toBe(401);
  });

  it("a body that is not JSON, or has no token: refused, no crash", async () => {
    verifyGoogle.mockResolvedValue(null);
    const notJson = new NextRequest("http://localhost/api/superadmin/session", {
      method: "POST",
      headers: { "x-forwarded-for": freshIp() },
      body: "<<<",
    });
    expect((await sessionPOST(notJson)).status).toBe(401);
    expect((await sessionPOST(sessionRequest({}))).status).toBe(401);
    expect((await sessionPOST(sessionRequest({ access_token: 5 }))).status).toBe(401);
  });

  it("the allowed account (any letter case): 200 and our own cookie", async () => {
    verifyGoogle.mockResolvedValue({ email: "Boss@Example.com", id: "u1" });
    const res = await sessionPOST(sessionRequest({ access_token: TOKEN }));
    expect(res.status).toBe(200);
    const answer = await res.text();
    expect(JSON.parse(answer)).toEqual({ ok: true });
    const cookie = (res as NextResponse).cookies.get(SUPERADMIN_COOKIE)!;
    expect(cookie).toMatchObject({ httpOnly: true, sameSite: "strict", path: "/", maxAge: 28800 });
    expect(verifySuperadminToken(cookie.value)).toMatchObject({ email: "boss@example.com" });
    expect(res.headers.get("cache-control")).toBe("no-store");
    // the Google token is not in the answer or in the cookie
    expect(answer).not.toContain(TOKEN);
    expect(cookie.value).not.toContain(TOKEN);
  });

  it("the token goes to Google's check and nowhere else", async () => {
    verifyGoogle.mockResolvedValue(null);
    await sessionPOST(sessionRequest({ access_token: TOKEN }));
    expect(verifyGoogle).toHaveBeenCalledWith(TOKEN);
  });

  it("rate limit: 10 attempts per address, then 429 (also for the right account)", async () => {
    verifyGoogle.mockResolvedValue(null);
    const ip = freshIp();
    for (let i = 0; i < 10; i++) expect((await sessionPOST(sessionRequest({ access_token: TOKEN }, ip))).status).toBe(401);
    const limited = await sessionPOST(sessionRequest({ access_token: TOKEN }, ip));
    expect(limited.status).toBe(429);
    verifyGoogle.mockResolvedValue({ email: ALLOWED, id: "u1" });
    expect((await sessionPOST(sessionRequest({ access_token: TOKEN }, ip))).status).toBe(429);
    // another address is not affected
    expect((await sessionPOST(sessionRequest({ access_token: TOKEN }, freshIp()))).status).toBe(200);
  });

  describe("the access log", () => {
    it("a success keeps the e-mail; no token, no raw address", async () => {
      verifyGoogle.mockResolvedValue({ email: ALLOWED, id: "u1" });
      const ip = "198.51.100.77";
      await sessionPOST(sessionRequest({ access_token: TOKEN }, ip));
      expect(accessLog()).toHaveLength(1);
      const row = accessLog()[0];
      expect(row).toMatchObject({ success: true, email: ALLOWED, email_hash: null, reason: null });
      expect(row.ip_hash).toMatch(/^[A-Za-z0-9_-]{20,}$/);
      const json = JSON.stringify(accessLog());
      expect(json).not.toContain(TOKEN);
      expect(json).not.toContain(ip);
    });

    it("a rejected attempt keeps a hash of the e-mail and the reason, never the e-mail", async () => {
      verifyGoogle.mockResolvedValue({ email: "stranger@example.com", id: "u1" });
      await sessionPOST(sessionRequest({ access_token: TOKEN }));
      verifyGoogle.mockResolvedValue(null);
      await sessionPOST(sessionRequest({ access_token: TOKEN }));
      const [notAllowed, badToken] = accessLog();
      expect(notAllowed).toMatchObject({ success: false, email: null, reason: "not_allowed" });
      expect(notAllowed.email_hash).toBe(keyedHash("stranger@example.com"));
      expect(badToken).toMatchObject({ success: false, email: null, email_hash: null, reason: "bad_token" });
      const json = JSON.stringify(accessLog());
      expect(json).not.toContain("stranger@example.com");
      expect(json).not.toContain(TOKEN);
    });

    it("the hash is keyed (not a plain hash of the e-mail) and the same e-mail always gives the same hash", () => {
      expect(keyedHash("a@example.com")).toBe(keyedHash("  A@Example.com "));
      expect(keyedHash("a@example.com")).not.toBe(keyedHash("b@example.com"));
      const { createHash } = require("node:crypto") as typeof import("node:crypto");
      expect(keyedHash("a@example.com")).not.toBe(createHash("sha256").update("a@example.com").digest("hex"));
      expect(keyedHash("a@example.com")).not.toBe(createHash("sha256").update("a@example.com").digest("base64url"));
    });

    it("a rejected row can never carry a raw e-mail (the database says so too)", () => {
      const row: AccessRow = toAccessRow({ success: false, rejectedEmail: "x@example.com", email: "y@example.com", reason: "not_allowed", ip: "1.2.3.4" });
      expect(row.email).toBeNull();
    });
  });

  it("logs nothing with the token, an e-mail or an address on the server console", async () => {
    const spies = (["log", "warn", "error", "info"] as const).map((m) => vi.spyOn(console, m).mockImplementation(() => {}));
    verifyGoogle.mockResolvedValueOnce({ email: "stranger@example.com", id: "u1" });
    await sessionPOST(sessionRequest({ access_token: TOKEN }, "198.51.100.5"));
    verifyGoogle.mockResolvedValueOnce({ email: ALLOWED, id: "u1" });
    await sessionPOST(sessionRequest({ access_token: TOKEN }, "198.51.100.6"));
    const logged = spies.flatMap((s) => s.mock.calls.map((c) => c.join(" "))).join("\n");
    spies.forEach((s) => s.mockRestore());
    for (const secret of [TOKEN, "stranger@example.com", ALLOWED, "198.51.100"]) expect(logged).not.toContain(secret);
  });
});

describe("every /api/superadmin route needs the cookie", () => {
  const signedIn = () => `${SUPERADMIN_COOKIE}=${createSuperadminToken(ALLOWED)}`;

  it("without a cookie: 401 JSON", async () => {
    const metrics = await metricsGET(new NextRequest("http://localhost/api/superadmin/metrics"));
    expect(metrics.status).toBe(401);
    expect(await metrics.json()).toEqual({ error: "unauthorized" });
    expect(metrics.headers.get("cache-control")).toBe("no-store");
    const logout = await logoutPOST(new NextRequest("http://localhost/api/superadmin/logout", { method: "POST" }));
    expect(logout.status).toBe(401);
  });

  it("with a cookie that is junk, expired or from another purpose: 401", async () => {
    const owner = createSessionToken("a1111111-1111-1111-1111-111111111111", "owner");
    for (const value of ["junk", "a.b", "", owner, createSuperadminToken(ALLOWED, Date.now() - 9 * 3600 * 1000)]) {
      expect((await metricsGET(withCookie("/api/superadmin/metrics", `${SUPERADMIN_COOKIE}=${value}`))).status, value.slice(0, 12)).toBe(401);
    }
    // the owner session cookie under its own name is no key either
    expect((await metricsGET(withCookie("/api/superadmin/metrics", `tornow_session=${owner}`))).status).toBe(401);
  });

  it("with a valid cookie whose e-mail was taken off the list since: 401 at once", async () => {
    const cookie = signedIn();
    expect((await metricsGET(withCookie("/api/superadmin/metrics", cookie))).status).toBe(200);
    process.env.SUPERADMIN_EMAILS = "someone-else@example.com";
    expect((await metricsGET(withCookie("/api/superadmin/metrics", cookie))).status).toBe(401);
    expect((await logoutPOST(withCookie("/api/superadmin/logout", cookie, "POST"))).status).toBe(401);
    delete process.env.SUPERADMIN_EMAILS;
    expect((await metricsGET(withCookie("/api/superadmin/metrics", cookie))).status).toBe(401);
  });

  it("with a valid cookie: the metrics, no-store", async () => {
    const res = await metricsGET(withCookie("/api/superadmin/metrics", signedIn()));
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const body = await res.json();
    expect(body.overview.businesses).toBeDefined();
    expect(body.sms.daily).toHaveLength(30);
    expect(body.revenue).toBeNull();
  });

  it("logout clears the cookie (and answers 401 and clears it even when there was none)", async () => {
    const ok = await logoutPOST(withCookie("/api/superadmin/logout", signedIn(), "POST"));
    expect(ok.status).toBe(200);
    expect(ok.cookies.get(SUPERADMIN_COOKIE)).toMatchObject({ value: "", maxAge: 0 });
    const none = await logoutPOST(new NextRequest("http://localhost/api/superadmin/logout", { method: "POST" }));
    expect(none.status).toBe(401);
    expect(none.cookies.get(SUPERADMIN_COOKIE)).toMatchObject({ value: "", maxAge: 0 });
  });
});

describe("privacy: nothing about a person in any response", () => {
  it("no key of any /api/superadmin answer looks like a phone, e-mail, password, token, message or name", async () => {
    // put a customer, an owner and a message in the sample data: none of it may come out
    const db = await import("@/lib/db");
    const business = await db.createBusiness({
      name: "סלון פרטיות",
      slug: "privacy-salon",
      owner_phone: "0529998877",
      owner_email: "owner-private@example.com",
      password: "Secret-Passw0rd!",
    });
    const [service] = [await db.createService({ business_id: business.id, name: "תספורת", duration_minutes: 30, buffer_minutes: 0, price: 80 })];
    const client = await db.findOrCreateClient(business.id, { phone: "0501112233", first_name: "דנה", last_name: "כהן", auth_provider: "guest" });
    await db.createAppointment({ business_id: business.id, service_id: service.id, client_id: client.id, start_time: new Date().toISOString(), end_time: new Date(Date.now() + 1800_000).toISOString() });
    const { insertSmsOutbox, finishSmsOutbox } = await import("@/lib/db/sms");
    const row = await insertSmsOutbox({ appointmentId: "x", businessId: business.id, kind: "booked", toPhone: "501112233", status: "pending" });
    await finishSmsOutbox(row!.id, { status: "sent", segments: 2 });

    const cookie = `${SUPERADMIN_COOKIE}=${createSuperadminToken(ALLOWED)}`;
    const responses: unknown[] = [];
    responses.push(await (await metricsGET(withCookie("/api/superadmin/metrics", cookie))).json());
    responses.push(await (await metricsGET(new NextRequest("http://localhost/api/superadmin/metrics"))).json());
    responses.push(await (await logoutPOST(withCookie("/api/superadmin/logout", cookie, "POST"))).json());
    verifyGoogle.mockResolvedValue({ email: ALLOWED, id: "u1" });
    responses.push(await (await sessionPOST(sessionRequest({ access_token: TOKEN }))).json());
    verifyGoogle.mockResolvedValue(null);
    responses.push(await (await sessionPOST(sessionRequest({ access_token: TOKEN }))).json());

    for (const r of responses) {
      for (const key of allKeys(r)) expect(key, `key "${key}"`).not.toMatch(PII_KEY);
    }

    // ... and none of the values: not the customer, the owner's phone or e-mail, the password
    const everything = JSON.stringify(responses);
    for (const secret of ["דנה", "כהן", "0501112233", "501112233", "0529998877", "owner-private@example.com", "Secret-Passw0rd!", ALLOWED]) {
      expect(everything, secret).not.toContain(secret);
    }
    // a business name and slug are fine, and they are there
    expect(everything).toContain("privacy-salon");
  });
});
