import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { SESSION_COOKIE, createSessionToken, toOwnerBusiness, toPublicBusiness } from "@/lib/auth";
import { preserveMissingSmsSettings, sanitizeSettings, smsSettingsError } from "@/lib/validation";
import { getSmsTemplate, reminderMinutes, shouldSendSms, smsBlockReason } from "@/lib/sms/policy";
import { SMS_REMINDER_OPTIONS, normalizeReminderMinutes, validateTemplate } from "@/lib/sms/message";
import type { Business, BusinessSettings } from "@/lib/types";

const BIZ = "b2222222-2222-2222-2222-222222222222"; // seeded sample business (the route tests need a real one)
const ctx = { businessName: "סלון נועה", longestServiceName: "תספורת", siteUrl: "https://tornow-eight.vercel.app" };

describe("the reminder options", () => {
  it("are never, 15, 30 minutes, an hour, two hours and a day before", () => {
    expect(SMS_REMINDER_OPTIONS.map((o) => o.minutes)).toEqual([0, 15, 30, 60, 120, 1440]);
    expect(SMS_REMINDER_OPTIONS.map((o) => o.label)).toEqual(["אף פעם", "15 דקות", "30 דקות", "שעה", "שעתיים", "יום לפני"]);
  });

  it("anything else, or nothing, means never", () => {
    for (const bad of [undefined, null, "", "abc", -5, 1, 45, 61, 1441, NaN, {}, [], true]) {
      expect(normalizeReminderMinutes(bad)).toBe(0);
    }
    expect(normalizeReminderMinutes(60)).toBe(60);
    expect(normalizeReminderMinutes("120")).toBe(120);
  });
});

describe("policy per kind", () => {
  const settings = (s: BusinessSettings) => ({ id: "biz", slug: "salon", settings: s });

  it("a confirmation follows the confirmation switch only", () => {
    expect(shouldSendSms(settings({}), "booked")).toBe(true);
    expect(shouldSendSms(settings({ sms_confirmation_enabled: false }), "booked")).toBe(false);
    expect(shouldSendSms(settings({ sms_confirmation_enabled: false, sms_reminder_minutes: 60 }), "booked")).toBe(false);
    expect(shouldSendSms(settings({ sms_reminder_minutes: 0 }), "booked")).toBe(true);
    expect(smsBlockReason(settings({ sms_confirmation_enabled: false }), "booked")).toBe("business_disabled");
  });

  it("a reminder follows the reminder setting only (default: never)", () => {
    expect(shouldSendSms(settings({}), "reminder")).toBe(false);
    expect(shouldSendSms(settings({ sms_reminder_minutes: 0 }), "reminder")).toBe(false);
    expect(shouldSendSms(settings({ sms_reminder_minutes: 60 }), "reminder")).toBe(true);
    expect(shouldSendSms(settings({ sms_reminder_minutes: 1440 }), "reminder")).toBe(true);
    // the confirmation switch is independent of reminders
    expect(shouldSendSms(settings({ sms_confirmation_enabled: false, sms_reminder_minutes: 60 }), "reminder")).toBe(true);
    expect(smsBlockReason(settings({}), "reminder")).toBe("reminder_disabled");
    // a stored value that is not one of the options is "never"
    expect(shouldSendSms(settings({ sms_reminder_minutes: 45 }), "reminder")).toBe(false);
    expect(reminderMinutes(settings({ sms_reminder_minutes: 30 }))).toBe(30);
    expect(reminderMinutes(null)).toBe(0);
  });

  it("each kind has its own wording", () => {
    const s = settings({ sms_confirmation_template: "אישור {link}", sms_reminder_template: "תזכורת {link}" });
    expect(getSmsTemplate(s, "booked")).toBe("אישור {link}");
    expect(getSmsTemplate(s, "reminder")).toBe("תזכורת {link}");
    expect(getSmsTemplate(settings({ sms_reminder_template: "  " }), "reminder")).toBeUndefined();
    expect(getSmsTemplate(settings({ sms_confirmation_template: "אישור {link}" }), "reminder")).toBeUndefined();
  });
});

describe("sanitizeSettings: the reminder settings", () => {
  it("keeps a valid time and wording", () => {
    expect(sanitizeSettings({ sms_reminder_minutes: 120, sms_reminder_template: " תזכורת ב-{time} {link} " })).toEqual({
      sms_reminder_minutes: 120,
      sms_reminder_template: "תזכורת ב-{time} {link}",
    });
  });

  it("0 (never) is a real value", () => {
    expect(sanitizeSettings({ sms_reminder_minutes: 0 })).toEqual({ sms_reminder_minutes: 0 });
  });

  it("a time that is not an option is dropped (= never)", () => {
    for (const bad of [45, "60", -1, 1, 1441, null, "never", {}, NaN]) {
      expect(sanitizeSettings({ sms_reminder_minutes: bad })).not.toHaveProperty("sms_reminder_minutes");
    }
  });

  it("an empty, null or unusable wording is not stored (= the default)", () => {
    for (const t of ["", "   ", null, 7, "מבצע https://evil.test", "שלום {x}", "א".repeat(400)]) {
      expect(sanitizeSettings({ sms_reminder_template: t })).not.toHaveProperty("sms_reminder_template");
    }
  });

  it("the wording is held to the same rules as the confirmation's", () => {
    for (const t of ["שלום {firstname}", "www.example.com {link}", "א".repeat(301), "{ {name} {link}"]) {
      expect(validateTemplate(t).ok).toBe(false);
      expect(smsSettingsError({ sms_reminder_template: t }, ctx)).toBe(smsSettingsError({ sms_confirmation_template: t }, ctx));
      expect(smsSettingsError({ sms_reminder_template: t }, ctx)).not.toBeNull();
    }
    expect(smsSettingsError({ sms_reminder_template: "תזכורת ב{business}: {date} {time} {link}" }, ctx)).toBeNull();
  });

  it("the wording is checked against the longest possible message, like the confirmation's", () => {
    const t = `${"א".repeat(126)} {name} {business} {service} {link}`;
    expect(smsSettingsError({ sms_reminder_template: t }, ctx)).toMatch(/ארוכה מדי/);
  });
});

describe("smsSettingsError: the reminder time", () => {
  it("accepts the options and null, refuses anything else", () => {
    for (const ok of [0, 15, 30, 60, 120, 1440, null]) expect(smsSettingsError({ sms_reminder_minutes: ok }, ctx)).toBeNull();
    for (const bad of [10, "60", 61, -1, {}, true]) {
      expect(smsSettingsError({ sms_reminder_minutes: bad }, ctx)).toBe("זמן התזכורת לא תקין");
    }
  });
});

describe("preserveMissingSmsSettings: the reminder settings", () => {
  const stored: BusinessSettings = {
    address: "old",
    sms_confirmation_enabled: false,
    sms_confirmation_template: "אישור {link}",
    sms_reminder_minutes: 60,
    sms_reminder_template: "תזכורת {link}",
  };
  const apply = (incoming: Record<string, unknown>, existing: BusinessSettings | undefined = stored) =>
    preserveMissingSmsSettings(incoming, sanitizeSettings(incoming), existing);

  it("a save from the General tab (no SMS keys) keeps all four", () => {
    expect(apply({ address: "new" })).toMatchObject({
      address: "new",
      sms_confirmation_enabled: false,
      sms_confirmation_template: "אישור {link}",
      sms_reminder_minutes: 60,
      sms_reminder_template: "תזכורת {link}",
    });
  });

  it("a key that is missing is kept, the others can change", () => {
    const out = apply({ sms_reminder_minutes: 15 });
    expect(out.sms_reminder_minutes).toBe(15);
    expect(out.sms_reminder_template).toBe("תזכורת {link}");
    expect(out.sms_confirmation_template).toBe("אישור {link}");
  });

  it("an explicit empty wording or null clears the reminder wording (back to the default)", () => {
    expect(apply({ sms_reminder_template: "" })).not.toHaveProperty("sms_reminder_template");
    expect(apply({ sms_reminder_template: null })).not.toHaveProperty("sms_reminder_template");
    expect(apply({ sms_reminder_template: "" }).sms_reminder_minutes).toBe(60); // the missing time is kept
  });

  it("0 is saved when it arrives, and is kept when it is stored", () => {
    expect(apply({ sms_reminder_minutes: 0 }).sms_reminder_minutes).toBe(0);
    expect(apply({ address: "x" }, { sms_reminder_minutes: 0 }).sms_reminder_minutes).toBe(0);
  });

  it("an explicit null time goes back to the default (never)", () => {
    expect(apply({ sms_reminder_minutes: null })).not.toHaveProperty("sms_reminder_minutes");
  });
});

describe("the reminder settings stay out of the public business JSON", () => {
  const business = {
    id: "b",
    name: "n",
    slug: "s",
    owner_phone: "0501234567",
    settings: {
      address: "הרצל 1",
      sms_confirmation_enabled: true,
      sms_confirmation_template: "אישור {link}",
      sms_reminder_minutes: 60,
      sms_reminder_template: "תזכורת {link}",
      theme_color: "ocean",
    },
  } as unknown as Business;

  it("toPublicBusiness keeps the address and the colour theme and nothing of the SMS", () => {
    const pub = toPublicBusiness(business);
    expect(pub.settings).toEqual({ address: "הרצל 1", theme_color: "ocean", sms_reminder_enabled: true });
    expect(JSON.stringify(pub)).not.toMatch(/sms_(confirmation|reminder_minutes|reminder_template)/);
  });

  it("the owner's own view has them", () => {
    expect(toOwnerBusiness(business, "owner").settings).toMatchObject({
      sms_reminder_minutes: 60,
      sms_reminder_template: "תזכורת {link}",
      theme_color: "ocean",
    });
  });
});

// --------------------------------------------------------------- the real routes, in-memory database

async function cookieFor(role: "owner" | "manager" | "staff") {
  const { getBusinessById } = await import("@/lib/db");
  const business = await getBusinessById(BIZ);
  return `${SESSION_COOKIE}=${createSessionToken(BIZ, role, undefined, business?.password)}`;
}

async function patchBusiness(cookie: string | null, body: unknown) {
  const { PATCH } = await import("@/app/api/business/route");
  return PATCH(
    new NextRequest("http://localhost/api/business", {
      method: "PATCH",
      headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) },
      body: JSON.stringify(body),
    })
  );
}

async function stored() {
  const { getBusinessById } = await import("@/lib/db");
  return (await getBusinessById(BIZ))!.settings ?? {};
}

describe("PATCH /api/business with the reminder settings (real route)", () => {
  it("saves them, and a General-tab save afterwards does not wipe them", async () => {
    const owner = await cookieFor("owner");
    const res = await patchBusiness(owner, {
      settings: { sms_reminder_minutes: 1440, sms_reminder_template: "תזכורת ב-{time}. {link}", theme_color: "plum" },
    });
    expect(res.status).toBe(200);
    expect(await stored()).toMatchObject({ sms_reminder_minutes: 1440, sms_reminder_template: "תזכורת ב-{time}. {link}", theme_color: "plum" });

    // the General tab knows nothing about reminders (it does send the colour it shows)
    const general = await patchBusiness(owner, { settings: { address: "הרצל 5", theme_color: "plum" } });
    expect(general.status).toBe(200);
    expect(await stored()).toMatchObject({
      address: "הרצל 5",
      sms_reminder_minutes: 1440,
      sms_reminder_template: "תזכורת ב-{time}. {link}",
    });
  });

  it("an explicit empty wording clears it; 0 turns reminders off and stays 0", async () => {
    const owner = await cookieFor("owner");
    await patchBusiness(owner, { settings: { sms_reminder_minutes: 30, sms_reminder_template: "תזכורת {link}" } });
    await patchBusiness(owner, { settings: { ...(await stored()), sms_reminder_template: "" } });
    const afterClear = await stored();
    expect(afterClear).not.toHaveProperty("sms_reminder_template");
    expect(afterClear.sms_reminder_minutes).toBe(30);

    await patchBusiness(owner, { settings: { sms_reminder_minutes: 0 } });
    expect((await stored()).sms_reminder_minutes).toBe(0);
    await patchBusiness(owner, { settings: { address: "x" } });
    expect((await stored()).sms_reminder_minutes).toBe(0);
  });

  it("refuses a bad time or wording with a clear message and keeps what was stored", async () => {
    const owner = await cookieFor("owner");
    await patchBusiness(owner, { settings: { sms_reminder_minutes: 60, sms_reminder_template: "תזכורת {link}" } });

    const badTime = await patchBusiness(owner, { settings: { sms_reminder_minutes: 45 } });
    expect(badTime.status).toBe(400);
    expect((await badTime.json()).error).toBe("זמן התזכורת לא תקין");

    const badWording = await patchBusiness(owner, { settings: { sms_reminder_template: "שלום {firstname}" } });
    expect(badWording.status).toBe(400);
    expect((await badWording.json()).error).toBe("משתנה לא מוכר: {firstname}");

    const withUrl = await patchBusiness(owner, { settings: { sms_reminder_template: "הנחה https://evil.test" } });
    expect(withUrl.status).toBe(400);

    expect(await stored()).toMatchObject({ sms_reminder_minutes: 60, sms_reminder_template: "תזכורת {link}" });
  });

  it("owner and manager may save; staff and anonymous callers may not", async () => {
    const body = { settings: { sms_reminder_minutes: 15 } };
    expect((await patchBusiness(await cookieFor("manager"), body)).status).toBe(200);
    expect((await patchBusiness(await cookieFor("staff"), body)).status).toBe(403);
    expect((await patchBusiness(null, body)).status).toBe(401);
  });

  it("the public GET never returns the reminder settings, but returns the colour theme", async () => {
    const owner = await cookieFor("owner");
    await patchBusiness(owner, { settings: { sms_reminder_minutes: 60, sms_reminder_template: "תזכורת {link}", theme_color: "rose" } });
    const { GET } = await import("@/app/api/business/route");
    const pub = await (await GET(new NextRequest("http://localhost/api/business?id=" + BIZ))).json();
    expect(JSON.stringify(pub)).not.toMatch(/sms_(confirmation|reminder_minutes|reminder_template)/);
    expect(pub.settings.theme_color).toBe("rose");
  });

  it("an unknown colour is not saved", async () => {
    const owner = await cookieFor("owner");
    await patchBusiness(owner, { settings: { theme_color: "teal" } });
    await patchBusiness(owner, { settings: { theme_color: "#ff0000" } });
    expect(await stored()).not.toHaveProperty("theme_color");
  });
});

describe("the old reminders route is retired", () => {
  const SECRET = "cron-secret-0123456789";

  it("answers 'nothing to do' and touches no appointment", async () => {
    process.env.CRON_SECRET = SECRET;
    const db = await import("@/lib/db");
    // the seeded barber-dan has appointments
    const snapshot = async () => (await db.getAppointments("a1111111-1111-1111-1111-111111111111")).map((a) => [a.id, a.reminder_sent, a.status, a.start_time]);
    const before = await snapshot();
    expect(before.length).toBeGreaterThan(0);

    const { GET, POST } = await import("@/app/api/cron/reminders/route");
    const headers = { authorization: `Bearer ${SECRET}` };
    for (const handler of [GET, POST]) {
      const res = await handler(new NextRequest("http://localhost/api/cron/reminders", { method: "POST", headers }));
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ success: true, deprecated: true, processed_count: 0 });
    }
    expect(await snapshot()).toEqual(before);
  });

  it("still wants authorisation", async () => {
    process.env.CRON_SECRET = SECRET;
    const { POST } = await import("@/app/api/cron/reminders/route");
    const res = await POST(new NextRequest("http://localhost/api/cron/reminders", { method: "POST" }));
    expect(res.status).toBe(401);
  });
});

describe("POST /api/cron/sms-outbox", () => {
  const SECRET = "cron-secret-0123456789";

  it("plans reminders first, then sends what is due, and reports both", async () => {
    process.env.CRON_SECRET = SECRET;
    const { POST } = await import("@/app/api/cron/sms-outbox/route");
    const res = await POST(
      new NextRequest("http://localhost/api/cron/sms-outbox", { method: "POST", headers: { authorization: `Bearer ${SECRET}` } })
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.reminders).toMatchObject({ planned: 0 });
    expect(body).toHaveProperty("processed");
  });

  it("wants the secret", async () => {
    process.env.CRON_SECRET = SECRET;
    const { POST } = await import("@/app/api/cron/sms-outbox/route");
    expect((await POST(new NextRequest("http://localhost/api/cron/sms-outbox", { method: "POST" }))).status).toBe(401);
  });
});
