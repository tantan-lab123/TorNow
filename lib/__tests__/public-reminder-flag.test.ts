import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { toOwnerBusiness, toPublicBusiness } from "@/lib/auth";
import type { Business } from "@/lib/types";

const business = (settings: Record<string, unknown> | undefined, over: Record<string, unknown> = {}) =>
  ({ id: "biz", name: "סלון", slug: "salon", owner_phone: "0501234567", settings, ...over }) as unknown as Business;

const flag = (b: Business) => toPublicBusiness(b).settings?.sms_reminder_enabled;

describe("settings.sms_reminder_enabled in the public business JSON", () => {
  it.each([15, 30, 60, 120, 1440])("%i minutes -> true", (minutes) => {
    expect(flag(business({ sms_reminder_minutes: minutes }))).toBe(true);
  });

  it.each([
    ["missing", {}],
    ["0 (never)", { sms_reminder_minutes: 0 }],
    ["not an option (45)", { sms_reminder_minutes: 45 }],
    ["negative", { sms_reminder_minutes: -15 }],
    ["null", { sms_reminder_minutes: null }],
    ["too big", { sms_reminder_minutes: 1441 }],
    ["not a number", { sms_reminder_minutes: "abc" }],
  ])("%s -> false", (_label, settings) => {
    expect(flag(business(settings))).toBe(false);
  });

  it("follows what would really be sent: the same reading of the stored value as the sender", () => {
    // (the settings screen only ever stores numbers; a numeric string is read the way the reminder planner reads it)
    expect(flag(business({ sms_reminder_minutes: "60" }))).toBe(true);
    expect(flag(business({ sms_reminder_minutes: "45" }))).toBe(false);
  });

  it("a demo business is always false, even with reminders on", () => {
    expect(flag(business({ sms_reminder_minutes: 60 }, { slug: "barber-dan" }))).toBe(false);
    expect(flag(business({ sms_reminder_minutes: 60 }, { slug: "maya-nails" }))).toBe(false);
    expect(flag(business({ sms_reminder_minutes: 60 }, { slug: "renamed", id: "a1111111-1111-1111-1111-111111111111" }))).toBe(false);
    // a normal business with the same settings is true
    expect(flag(business({ sms_reminder_minutes: 60 }))).toBe(true);
  });

  it("the time and the wording are still not public", () => {
    const pub = toPublicBusiness(
      business({
        sms_reminder_minutes: 60,
        sms_reminder_template: "תזכורת {link}",
        sms_confirmation_enabled: false,
        sms_confirmation_template: "אישור {link}",
        address: "הרצל 1",
      })
    );
    expect(pub.settings).toEqual({ address: "הרצל 1", sms_reminder_enabled: true });
    expect(pub.settings).not.toHaveProperty("sms_reminder_minutes");
    expect(pub.settings).not.toHaveProperty("sms_reminder_template");
    expect(pub.settings).not.toHaveProperty("sms_confirmation_enabled");
    expect(pub.settings).not.toHaveProperty("sms_confirmation_template");
    const json = JSON.stringify(pub);
    expect(json).not.toContain("sms_reminder_minutes");
    expect(json).not.toContain("sms_reminder_template");
    expect(json).not.toContain("תזכורת {link}");
  });

  it("a business without any settings is left as it was", () => {
    expect(toPublicBusiness(business(undefined)).settings).toBeUndefined();
  });

  it("does not change the object it is given", () => {
    const b = business({ sms_reminder_minutes: 60 });
    toPublicBusiness(b);
    expect(b.settings).toEqual({ sms_reminder_minutes: 60 });
  });

  it("the owner's own view keeps the real time and has no computed flag", () => {
    const own = toOwnerBusiness(business({ sms_reminder_minutes: 60, sms_reminder_template: "x {link}" }), "owner");
    expect(own.settings).toMatchObject({ sms_reminder_minutes: 60, sms_reminder_template: "x {link}" });
    expect(own.settings).not.toHaveProperty("sms_reminder_enabled");
  });
});

describe("the booking page notice", () => {
  const page = readFileSync("app/[slug]/BookingPage.tsx", "utf8");

  it("says 'and a reminder' only when the business has reminders", () => {
    expect(page).toContain("business?.settings?.sms_reminder_enabled");
    expect(page).toContain('"תקבל/י SMS אישור עם קישור לניהול התור, ותזכורת לפני התור."');
    // the plain sentence is exactly the old one
    expect(page).toContain('"תקבל/י SMS אישור עם קישור לניהול התור."');
  });

  it("the notice is shown nowhere else (no other copy to keep in step)", () => {
    const hits = ["app", "components"].flatMap((dir) => listFiles(dir)).filter((f) => readFileSync(f, "utf8").includes("תקבל/י SMS"));
    expect(hits).toEqual(["app/[slug]/BookingPage.tsx"]);
  });
});

import { readdirSync, statSync } from "node:fs";
function listFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = `${dir}/${name}`;
    return statSync(path).isDirectory() ? listFiles(path) : /\.(ts|tsx)$/.test(path) ? [path] : [];
  });
}
