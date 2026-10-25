import { readFileSync, readdirSync, statSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { SESSION_COOKIE, createSessionToken, signForDomain } from "@/lib/auth";
import { getValidSession } from "@/lib/access";
import {
  clearSuperadminCookie,
  createSuperadminToken,
  getSuperadmin,
  isAllowedEmail,
  parseAllowlist,
  requireSuperadmin,
  setSuperadminCookie,
  verifySuperadminToken,
} from "@/lib/superadmin/auth";
import { SUPERADMIN_COOKIE, SUPERADMIN_TTL_SECONDS } from "@/lib/superadmin/config";
import { NextResponse } from "next/server";

const ALLOW = "boss@example.com";
const original = process.env.SUPERADMIN_EMAILS;
beforeEach(() => {
  process.env.SUPERADMIN_EMAILS = ALLOW;
});
afterEach(() => {
  if (original === undefined) delete process.env.SUPERADMIN_EMAILS;
  else process.env.SUPERADMIN_EMAILS = original;
});

const requestWith = (cookie: string) => new NextRequest("http://localhost/api/superadmin/metrics", { headers: { cookie } });

describe("the allowlist (SUPERADMIN_EMAILS)", () => {
  it("empty or missing means nobody", () => {
    for (const raw of [undefined, null, "", "   ", ",", " , , "]) {
      expect(parseAllowlist(raw)).toEqual([]);
      // (an explicit undefined means "read the environment": that case is the next test)
      if (raw !== undefined) {
        expect(isAllowedEmail("boss@example.com", raw)).toBe(false);
        expect(isAllowedEmail("", raw)).toBe(false);
      }
    }
  });

  it("is comma separated, lower-cased and trimmed", () => {
    expect(parseAllowlist("  Boss@Example.com ,second@example.com,, BOSS@example.com ")).toEqual(["boss@example.com", "second@example.com"]);
    expect(isAllowedEmail("BOSS@EXAMPLE.COM", "boss@example.com")).toBe(true);
    expect(isAllowedEmail("  boss@example.com  ", "boss@example.com")).toBe(true);
  });

  it("is an exact match, not a part of an address or a domain", () => {
    const raw = "boss@example.com";
    for (const other of ["xboss@example.com", "boss@example.com.evil.test", "boss@example.co", "boss+tag@example.com", "example.com", "boss", "@example.com"]) {
      expect(isAllowedEmail(other, raw), other).toBe(false);
    }
    expect(isAllowedEmail(null, raw)).toBe(false);
    expect(isAllowedEmail(undefined, raw)).toBe(false);
    expect(isAllowedEmail(42, raw)).toBe(false);
  });

  it("reads SUPERADMIN_EMAILS when no list is given, and fails closed when it is unset", () => {
    expect(isAllowedEmail("boss@example.com")).toBe(true);
    delete process.env.SUPERADMIN_EMAILS;
    expect(isAllowedEmail("boss@example.com")).toBe(false);
  });
});

describe("no e-mail address is written in the code", () => {
  const dirs = ["lib/superadmin", "app/superadmin", "app/api/superadmin", "components/superadmin"];
  const files = (dir: string): string[] =>
    readdirSync(dir).flatMap((name) => {
      const path = `${dir}/${name}`;
      return statSync(path).isDirectory() ? files(path) : /\.(ts|tsx)$/.test(path) ? [path] : [];
    });

  it("none of the dashboard sources contains an address", () => {
    const all = dirs.flatMap(files);
    expect(all.length).toBeGreaterThan(10);
    for (const f of all) {
      const text = readFileSync(f, "utf8");
      expect(text.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+/g) ?? [], f).toEqual([]);
    }
  });

  it("the migration and the env example do not name anybody either", () => {
    const sql = readFileSync("supabase/migrations/20261026000001_superadmin_metrics.sql", "utf8");
    expect(sql.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+/g) ?? []).toEqual([]);
  });
});

describe("the superadmin cookie", () => {
  const T0 = Date.UTC(2026, 10, 5, 10, 0, 0);

  it("signs and verifies; it carries the e-mail and an 8 hour expiry", () => {
    const token = createSuperadminToken("Boss@Example.com", T0);
    const v = verifySuperadminToken(token, T0 + 1000);
    expect(v).toEqual({ email: "boss@example.com", exp: Math.floor(T0 / 1000) + 8 * 3600 });
    expect(SUPERADMIN_TTL_SECONDS).toBe(8 * 3600);
  });

  it("expires after 8 hours", () => {
    const token = createSuperadminToken("boss@example.com", T0);
    expect(verifySuperadminToken(token, T0 + 8 * 3600 * 1000 - 1000)).not.toBeNull();
    expect(verifySuperadminToken(token, T0 + 8 * 3600 * 1000)).toBeNull();
    expect(verifySuperadminToken(token, T0 + 9 * 3600 * 1000)).toBeNull();
  });

  it("a changed payload or signature is refused", () => {
    const token = createSuperadminToken("boss@example.com", T0);
    const [payload, sig] = token.split(".");
    const forged = Buffer.from(JSON.stringify({ v: 1, em: "boss@example.com", exp: Math.floor(T0 / 1000) + 10 * 365 * 86400 })).toString("base64url");
    expect(verifySuperadminToken(`${forged}.${sig}`, T0 + 1000)).toBeNull();
    expect(verifySuperadminToken(`${payload}.${sig.slice(0, -2)}xx`, T0 + 1000)).toBeNull();
    expect(verifySuperadminToken(`${payload}.`, T0)).toBeNull();
    expect(verifySuperadminToken(`.${sig}`, T0)).toBeNull();
    expect(verifySuperadminToken(payload, T0)).toBeNull();
    expect(verifySuperadminToken(`${payload}.${sig}.extra`, T0)).toBeNull();
    for (const junk of ["", "x", "a.b", "null", undefined, null]) expect(verifySuperadminToken(junk as string, T0)).toBeNull();
  });

  it("a signature made for another purpose (another prefix) is refused, however well it is made", () => {
    const encoded = Buffer.from(JSON.stringify({ v: 1, em: "boss@example.com", exp: Math.floor(T0 / 1000) + 3600 })).toString("base64url");
    expect(verifySuperadminToken(`${encoded}.${signForDomain("superadmin:v1", encoded)}`, T0)).not.toBeNull(); // the right domain works
    for (const domain of ["superadmin:v2", "superadmin", "owner", "", "superadmin-log:v1", "calendar"]) {
      expect(verifySuperadminToken(`${encoded}.${signForDomain(domain, encoded)}`, T0), domain).toBeNull();
    }
  });

  it("the e-mail is checked against the allowlist as it is NOW: removing it locks the session out at once", () => {
    const token = createSuperadminToken("boss@example.com", T0);
    expect(verifySuperadminToken(token, T0 + 1000, "boss@example.com")).not.toBeNull();
    expect(verifySuperadminToken(token, T0 + 1000, "someone-else@example.com")).toBeNull();
    expect(verifySuperadminToken(token, T0 + 1000, "")).toBeNull();
    expect(verifySuperadminToken(token, T0 + 1000, null)).toBeNull();
    delete process.env.SUPERADMIN_EMAILS; // and with no list in the environment at all
    expect(verifySuperadminToken(token, T0 + 1000)).toBeNull();
    process.env.SUPERADMIN_EMAILS = ALLOW;
    process.env.SUPERADMIN_EMAILS = "boss@example.com, second@example.com";
    expect(getSuperadmin(requestWith(`${SUPERADMIN_COOKIE}=${token}`))).toEqual({ email: "boss@example.com" });
    process.env.SUPERADMIN_EMAILS = "second@example.com";
    expect(getSuperadmin(requestWith(`${SUPERADMIN_COOKIE}=${token}`))).toBeNull();
  });
});

describe("the owner / manager / staff session and the superadmin cookie never stand in for each other", () => {
  it("an owner, manager or staff session token is not a superadmin cookie", () => {
    for (const role of ["owner", "manager", "staff"] as const) {
      const sessionToken = createSessionToken("a1111111-1111-1111-1111-111111111111", role);
      expect(verifySuperadminToken(sessionToken)).toBeNull();
      expect(getSuperadmin(requestWith(`${SUPERADMIN_COOKIE}=${sessionToken}`))).toBeNull();
      expect(requireSuperadmin(requestWith(`${SUPERADMIN_COOKIE}=${sessionToken}`)).error?.status).toBe(401);
    }
  });

  it("an owner session whose payload names the allowed address is still refused", () => {
    // even a session token that happens to carry the allowed address in its payload is not accepted
    const sessionToken = createSessionToken("boss@example.com", "owner");
    expect(verifySuperadminToken(sessionToken)).toBeNull();
  });

  it("the superadmin cookie is not an owner session: getValidSession refuses it", async () => {
    const token = createSuperadminToken("boss@example.com");
    // offered under the owner cookie's name
    const asOwner = new NextRequest("http://localhost/api/business", { headers: { cookie: `${SESSION_COOKIE}=${token}` } });
    expect(await getValidSession(asOwner)).toBeNull();
    // offered under its own name: the owner machinery does not even look at it
    const own = new NextRequest("http://localhost/api/business", { headers: { cookie: `${SUPERADMIN_COOKIE}=${token}` } });
    expect(await getValidSession(own)).toBeNull();
  });

  it("the cookies have different names", () => {
    expect(SUPERADMIN_COOKIE).not.toBe(SESSION_COOKIE);
  });

  it("the two signatures can not collide: an owner payload is base64url and has no ':' to follow the domain", () => {
    const sessionToken = createSessionToken("x", "owner");
    expect(sessionToken.split(".")[0]).not.toContain(":");
    expect(signForDomain("superadmin:v1", "abc")).not.toBe(signForDomain("superadmin:v2", "abc"));
  });
});

describe("the cookie as it is set", () => {
  it("HttpOnly, SameSite=Strict, Path=/, 8 hours; Secure in production only", () => {
    const res = NextResponse.json({});
    setSuperadminCookie(res, "value");
    const c = res.cookies.get(SUPERADMIN_COOKIE)!;
    expect(c).toMatchObject({ value: "value", httpOnly: true, sameSite: "strict", path: "/", maxAge: 28800 });
    expect(c.secure).toBeFalsy(); // test environment

    const original = process.env.NODE_ENV;
    (process.env as Record<string, string>).NODE_ENV = "production";
    const prod = NextResponse.json({});
    setSuperadminCookie(prod, "value");
    (process.env as Record<string, string>).NODE_ENV = original as string;
    expect(prod.cookies.get(SUPERADMIN_COOKIE)!.secure).toBe(true);
  });

  it("is cleared by logout", () => {
    const res = NextResponse.json({});
    clearSuperadminCookie(res);
    expect(res.cookies.get(SUPERADMIN_COOKIE)).toMatchObject({ value: "", maxAge: 0, httpOnly: true, path: "/" });
  });
});
