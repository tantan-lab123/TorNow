import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { SESSION_COOKIE, createSessionToken, toOwnerBusiness, toPublicBusiness } from "@/lib/auth";
import {
  preserveMissingSmsSettings,
  sanitizeSettings,
  smsSettingsError,
} from "@/lib/validation";
import type { Business, BusinessSettings } from "@/lib/types";

const BIZ = "a1111111-1111-1111-1111-111111111111"; // seeded sample business
const ctx = { businessName: "סלון נועה", longestServiceName: "תספורת גברים קלאסית", siteUrl: "https://tornow-eight.vercel.app" };

describe("sanitizeSettings: the SMS settings", () => {
  it("keeps a valid switch and wording", () => {
    const out = sanitizeSettings({ sms_confirmation_enabled: false, sms_confirmation_template: " תור ב-{date} {link} " });
    expect(out.sms_confirmation_enabled).toBe(false);
    expect(out.sms_confirmation_template).toBe("תור ב-{date} {link}");
  });

  it("false is a real value and is not dropped", () => {
    expect(sanitizeSettings({ sms_confirmation_enabled: false })).toEqual({ sms_confirmation_enabled: false });
    expect(sanitizeSettings({ sms_confirmation_enabled: true })).toEqual({ sms_confirmation_enabled: true });
  });

  it("an empty, null or unusable wording is not stored (= the default)", () => {
    for (const t of ["", "   ", null, 42, "מבצע https://evil.test", "שלום {x}", "א".repeat(400)]) {
      expect(sanitizeSettings({ sms_confirmation_template: t })).not.toHaveProperty("sms_confirmation_template");
    }
  });

  it("does not turn other settings into something else", () => {
    expect(sanitizeSettings({ address: "הרצל 1", sms_confirmation_enabled: false })).toEqual({
      address: "הרצל 1",
      sms_confirmation_enabled: false,
    });
  });
});

describe("preserveMissingSmsSettings", () => {
  const stored: BusinessSettings = {
    address: "old",
    sms_confirmation_enabled: false,
    sms_confirmation_template: "תור {date} {link}",
  };
  const apply = (incoming: Record<string, unknown>, existing: BusinessSettings | undefined = stored) =>
    preserveMissingSmsSettings(incoming, sanitizeSettings(incoming), existing);

  it("a key that is missing keeps its stored value (a save from the General tab)", () => {
    const out = apply({ address: "new", whatsapp_phone: "0501234567" });
    expect(out).toMatchObject({ address: "new", sms_confirmation_enabled: false, sms_confirmation_template: "תור {date} {link}" });
  });

  it("only a missing key is kept: the other one can be changed", () => {
    const out = apply({ sms_confirmation_enabled: true });
    expect(out.sms_confirmation_enabled).toBe(true);
    expect(out.sms_confirmation_template).toBe("תור {date} {link}");
  });

  it("an explicit empty string clears the wording (back to the default)", () => {
    const out = apply({ sms_confirmation_template: "" });
    expect(out).not.toHaveProperty("sms_confirmation_template");
    expect(out.sms_confirmation_enabled).toBe(false); // the missing switch is still kept
  });

  it("an explicit null clears the wording too", () => {
    const out = apply({ sms_confirmation_template: null });
    expect(out).not.toHaveProperty("sms_confirmation_template");
  });

  it("false is saved when it arrives, and is kept when it is already stored", () => {
    expect(apply({ sms_confirmation_enabled: false }, { sms_confirmation_enabled: true }).sms_confirmation_enabled).toBe(false);
    expect(apply({ address: "x" }, { sms_confirmation_enabled: false }).sms_confirmation_enabled).toBe(false);
  });

  it("an explicit null switch goes back to the default (on)", () => {
    expect(apply({ sms_confirmation_enabled: null })).not.toHaveProperty("sms_confirmation_enabled");
  });

  it("nothing stored and nothing sent: nothing appears", () => {
    const raw = { address: "x" };
    expect(preserveMissingSmsSettings(raw, sanitizeSettings(raw), undefined)).toEqual({ address: "x" });
    expect(apply(raw, {})).toEqual({ address: "x" });
  });

  it("does not touch other stored settings that were not sent (they are replaced, as before)", () => {
    expect(apply({ address: "new" })).not.toHaveProperty("whatsapp_phone");
  });
});

describe("smsSettingsError", () => {
  it("is fine without SMS settings, with the default, and with empty values", () => {
    expect(smsSettingsError({ address: "x" }, ctx)).toBeNull();
    expect(smsSettingsError({ sms_confirmation_template: "" }, ctx)).toBeNull();
    expect(smsSettingsError({ sms_confirmation_template: null }, ctx)).toBeNull();
    expect(smsSettingsError({ sms_confirmation_enabled: false }, ctx)).toBeNull();
    expect(smsSettingsError({ sms_confirmation_enabled: null }, ctx)).toBeNull();
    expect(smsSettingsError({ sms_confirmation_template: "נקבע ב-{date} בשעה {time}. {link}" }, ctx)).toBeNull();
  });

  it("explains what is wrong", () => {
    expect(smsSettingsError({ sms_confirmation_template: "שלום {firstname}" }, ctx)).toBe("משתנה לא מוכר: {firstname}");
    expect(smsSettingsError({ sms_confirmation_template: "https://evil.test {link}" }, ctx)).toMatch(/קישורים/);
    expect(smsSettingsError({ sms_confirmation_template: "א".repeat(301) }, ctx)).toMatch(/ארוך מדי/);
    expect(smsSettingsError({ sms_confirmation_template: 5 }, ctx)).toBe("נוסח ההודעה לא תקין");
    expect(smsSettingsError({ sms_confirmation_enabled: "no" }, ctx)).toBe("ערך לא תקין למתג ה-SMS");
  });

  it("checks the longest message the wording can produce for this business", () => {
    const t = `${"א".repeat(120)} {name} {business} {service} {link}`;
    expect(smsSettingsError({ sms_confirmation_template: t }, ctx)).toMatch(/ארוכה מדי/);
    expect(smsSettingsError({ sms_confirmation_template: t }, { ...ctx, businessName: "", longestServiceName: "" })).toBeNull();
  });
});

describe("the SMS settings stay out of the public business JSON", () => {
  const business = {
    id: "b",
    name: "n",
    slug: "s",
    owner_phone: "0501234567",
    settings: {
      address: "הרצל 1",
      og_image_url: "https://x.test/a.png",
      sms_confirmation_enabled: false,
      sms_confirmation_template: "תור {date} {link}",
    },
  } as unknown as Business;

  it("toPublicBusiness removes them (and keeps the rest)", () => {
    const pub = toPublicBusiness(business);
    expect(pub.settings).toEqual({ address: "הרצל 1", sms_reminder_enabled: false });
    expect(JSON.stringify(pub)).not.toMatch(/sms_confirmation/);
  });

  it("does not change the object it is given", () => {
    toPublicBusiness(business);
    expect(business.settings?.sms_confirmation_enabled).toBe(false);
  });

  it("the owner's own view still has them", () => {
    const own = toOwnerBusiness(business, "owner");
    expect(own.settings).toMatchObject({ sms_confirmation_enabled: false, sms_confirmation_template: "תור {date} {link}" });
  });
});

// --------------------------------------------------------------- the real routes, in-memory database

async function cookieFor(role: "owner" | "manager" | "staff") {
  const { getBusinessById } = await import("@/lib/db");
  const business = await getBusinessById(BIZ);
  const token = createSessionToken(BIZ, role, undefined, business?.password);
  return `${SESSION_COOKIE}=${token}`;
}

async function patchBusiness(cookie: string | null, body: unknown) {
  const { PATCH } = await import("@/app/api/business/route");
  const req = new NextRequest("http://localhost/api/business", {
    method: "PATCH",
    headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) },
    body: JSON.stringify(body),
  });
  return PATCH(req);
}

async function stored() {
  const { getBusinessById } = await import("@/lib/db");
  return (await getBusinessById(BIZ))!.settings ?? {};
}

describe("PATCH /api/business with the SMS settings (real route, in-memory database)", () => {
  it("saves the switch and wording, and a later save from another tab does not wipe them", async () => {
    const owner = await cookieFor("owner");

    const res = await patchBusiness(owner, {
      settings: { sms_confirmation_enabled: false, sms_confirmation_template: "תור ב-{date} ב-{time}. {link}" },
    });
    expect(res.status).toBe(200);
    expect(await stored()).toMatchObject({ sms_confirmation_enabled: false, sms_confirmation_template: "תור ב-{date} ב-{time}. {link}" });

    // a save from the "General" tab: it knows nothing about the SMS settings
    const general = await patchBusiness(owner, { settings: { address: "הרצל 5", whatsapp_phone: "0501234567" } });
    expect(general.status).toBe(200);
    expect(await stored()).toMatchObject({
      address: "הרצל 5",
      sms_confirmation_enabled: false,
      sms_confirmation_template: "תור ב-{date} ב-{time}. {link}",
    });

    // the calendar reminder save sends the stored settings back: still intact
    const calendar = await patchBusiness(owner, { settings: { ...(await stored()), calendar_reminder_minutes: 30 } });
    expect(calendar.status).toBe(200);
    expect(await stored()).toMatchObject({ calendar_reminder_minutes: 30, sms_confirmation_enabled: false });
  });

  it("an explicit empty wording goes back to the default; false and true are both real values", async () => {
    const owner = await cookieFor("owner");
    await patchBusiness(owner, { settings: { sms_confirmation_template: "תור ב-{date}. {link}", sms_confirmation_enabled: false } });

    const reset = await patchBusiness(owner, { settings: { ...(await stored()), sms_confirmation_template: "" } });
    expect(reset.status).toBe(200);
    const afterReset = await stored();
    expect(afterReset).not.toHaveProperty("sms_confirmation_template");
    expect(afterReset.sms_confirmation_enabled).toBe(false);

    await patchBusiness(owner, { settings: { sms_confirmation_enabled: true } });
    expect((await stored()).sms_confirmation_enabled).toBe(true);
    await patchBusiness(owner, { settings: { sms_confirmation_enabled: false } });
    expect((await stored()).sms_confirmation_enabled).toBe(false);
  });

  it("refuses a bad wording with a clear message and keeps what was stored", async () => {
    const owner = await cookieFor("owner");
    await patchBusiness(owner, { settings: { sms_confirmation_template: "תור ב-{date}. {link}" } });

    for (const [wording, message] of [
      ["שלום {firstname}", "משתנה לא מוכר: {firstname}"],
      ["הנחה! https://evil.test", "אסור לכלול קישורים או כתובות אתר בהודעה. הקישור היחיד המותר הוא {link}"],
    ]) {
      const res = await patchBusiness(owner, { settings: { sms_confirmation_template: wording } });
      expect(res.status).toBe(400);
      expect((await res.json()).error).toBe(message);
    }
    const tooLong = await patchBusiness(owner, { settings: { sms_confirmation_template: "א".repeat(301) } });
    expect(tooLong.status).toBe(400);
    expect((await stored()).sms_confirmation_template).toBe("תור ב-{date}. {link}");
  });

  it("owner and manager may save; staff and anonymous callers may not", async () => {
    const body = { settings: { sms_confirmation_enabled: true } };
    expect((await patchBusiness(await cookieFor("manager"), body)).status).toBe(200);
    expect((await patchBusiness(await cookieFor("staff"), body)).status).toBe(403);
    expect((await patchBusiness(null, body)).status).toBe(401);
  });

  it("the public GET never returns the SMS settings, the owner's own GET does", async () => {
    const owner = await cookieFor("owner");
    await patchBusiness(owner, { settings: { sms_confirmation_enabled: false, sms_confirmation_template: "תור ב-{date}. {link}" } });
    const { GET } = await import("@/app/api/business/route");

    const pub = await GET(new NextRequest("http://localhost/api/business?id=" + BIZ));
    const pubJson = JSON.stringify(await pub.json());
    expect(pubJson).not.toMatch(/sms_confirmation/);

    const own = await GET(new NextRequest("http://localhost/api/business?id=" + BIZ, { headers: { cookie: owner } }));
    expect((await own.json()).settings).toMatchObject({ sms_confirmation_enabled: false });
  });
});

describe("GET /api/sms/usage (real route, in-memory database)", () => {
  async function getUsage(cookie: string | null) {
    const { GET } = await import("@/app/api/sms/usage/route");
    return GET(new NextRequest("http://localhost/api/sms/usage", { headers: cookie ? { cookie } : {} }));
  }

  it("owner and manager only", async () => {
    expect((await getUsage(await cookieFor("owner"))).status).toBe(200);
    expect((await getUsage(await cookieFor("manager"))).status).toBe(200);
    expect((await getUsage(await cookieFor("staff"))).status).toBe(403);
    expect((await getUsage(null)).status).toBe(401);
  });

  it("counts only this business's sent messages: billed messages (the owner's number) and segments", async () => {
    const { insertSmsOutbox, finishSmsOutbox } = await import("@/lib/db/sms");
    const queue = async (
      businessId: string,
      appointmentId: string,
      status: "sent" | "skipped" | "failed",
      segments?: number,
      billedMessages?: number
    ) => {
      const row = await insertSmsOutbox({ appointmentId, businessId, kind: "booked", toPhone: "501234567", status: "pending" });
      await finishSmsOutbox(row!.id, {
        status,
        ...(segments !== undefined ? { segments } : {}),
        ...(billedMessages !== undefined ? { billedMessages } : {}),
      });
    };
    const before = await (await getUsage(await cookieFor("owner"))).json();

    await queue(BIZ, "usage-a1", "sent", 2, 1);
    await queue(BIZ, "usage-a2", "sent", 9, 3); // a long message: three billed
    await queue(BIZ, "usage-a2b", "sent", 3); // sent before billed_messages existed: counts 1
    await queue(BIZ, "usage-a3", "skipped", undefined, 2);
    await queue(BIZ, "usage-a4", "failed", undefined, 2);
    await queue("another-business", "usage-b1", "sent", 4, 2);

    const after = await (await getUsage(await cookieFor("owner"))).json();
    expect(after.sent - before.sent).toBe(3);
    expect(after.billed - before.billed).toBe(5); // 1 + 3 + 1
    expect(after.segments - before.segments).toBe(14);
    expect(typeof after.since).toBe("string");
  });
});
