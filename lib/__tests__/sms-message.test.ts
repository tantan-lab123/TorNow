import { describe, expect, it } from "vitest";
import {
  DEFAULT_BOOKED_TEMPLATE,
  SMS_LINK_LENGTH_FALLBACK,
  SMS_TEMPLATE_MAX_RAW,
  checkWorstCaseLength,
  countSegments,
  manageLinkLength,
  previewVars,
  renderBookedMessage,
  renderBookedMessageDetailed,
  validateTemplate,
  type SmsVars,
} from "@/lib/sms/message";
import { SKIP_BUSINESS_DISABLED, getSmsTemplate, shouldSendSms } from "@/lib/sms/policy";

/** The real link: https://tornow-eight.vercel.app/t/<32 chars> = 66 characters */
const LINK = `https://tornow-eight.vercel.app/t/${"a".repeat(32)}`;

const vars = (over: Partial<SmsVars> = {}): SmsVars => ({
  name: "דנה",
  business: "סלון נועה",
  service: "תספורת",
  date: "05/11",
  time: "15:30",
  link: LINK,
  ...over,
});

describe("the real link is 66 characters", () => {
  it("matches the length the default is measured with", () => {
    expect(LINK).toHaveLength(66);
    expect(manageLinkLength("https://tornow-eight.vercel.app")).toBe(66);
    expect(manageLinkLength("https://tornow-eight.vercel.app/")).toBe(66);
    expect(SMS_LINK_LENGTH_FALLBACK).toBe(66);
  });
});

describe("default wording", () => {
  it("fits in at most 2 SMS segments with the real 66-character link", () => {
    const text = renderBookedMessage(null, vars());
    expect(text).toBe(`נקבע לך תור לסלון נועה ב-05/11 בשעה 15:30.\nלשינוי/ביטול: ${LINK}`);
    expect(text.length).toBe(123);
    expect(countSegments(text).segments).toBeLessThanOrEqual(2);
  });

  it("still fits in 2 segments for a business name up to 20 characters", () => {
    const text = renderBookedMessage(undefined, vars({ business: "ב".repeat(20) }));
    expect(countSegments(text).segments).toBeLessThanOrEqual(2);
  });

  it("is used for an empty or blank template, without calling it a fallback", () => {
    for (const t of [undefined, null, "", "   \n "]) {
      const r = renderBookedMessageDetailed(t, vars());
      expect(r.fellBack).toBe(false);
      expect(r.text).toBe(renderBookedMessage(DEFAULT_BOOKED_TEMPLATE, vars()));
    }
  });

  it("never shortens the link, even for the longest possible business name", () => {
    const text = renderBookedMessage(null, vars({ business: "ע".repeat(120) }));
    expect(text.endsWith(LINK)).toBe(true);
    expect(text.split("\n").pop()).toBe(`לשינוי/ביטול: ${LINK}`);
  });
});

describe("renderBookedMessage", () => {
  it("fills every variable", () => {
    const t = "{name}|{business}|{service}|{date}|{time}|{link}";
    expect(renderBookedMessage(t, vars())).toBe(`דנה|סלון נועה|תספורת|05/11|15:30|${LINK}`);
  });

  it("fills a variable that appears twice", () => {
    expect(renderBookedMessage("{time} או {time} {link}", vars())).toBe(`15:30 או 15:30 ${LINK}`);
  });

  it("drops the greeting when there is no first name (no 'שלום ,')", () => {
    const t = "שלום {name}, נקבע לך תור ל{business}.\n{link}";
    for (const name of [undefined, null, "", "   "]) {
      const text = renderBookedMessage(t, vars({ name }));
      expect(text).toBe(`נקבע לך תור לסלון נועה.\n${LINK}`);
      expect(text).not.toContain("שלום");
    }
    expect(renderBookedMessage(t, vars())).toBe(`שלום דנה, נקבע לך תור לסלון נועה.\n${LINK}`);
  });

  it("cleans other leftovers of an empty variable", () => {
    expect(renderBookedMessage("{name}, נקבע לך תור.\n{link}", vars({ name: "" }))).toBe(`נקבע לך תור.\n${LINK}`);
    expect(renderBookedMessage("נקבע תור ל{service} ב-{date}.\n{link}", vars({ service: "" }))).toBe(
      `נקבע תור ב-05/11.\n${LINK}`
    );
    expect(renderBookedMessage("תור ({service}) ב-{date}\n{link}", vars({ service: "" }))).toBe(`תור ב-05/11\n${LINK}`);
  });

  it("adds the link on a new line at the end when the wording has none", () => {
    expect(renderBookedMessage("נקבע לך תור ב-{date}", vars())).toBe(`נקבע לך תור ב-05/11\n${LINK}`);
  });

  it("does not add a second link when there is one", () => {
    const text = renderBookedMessage("הקישור: {link} תודה", vars());
    expect(text.split(LINK)).toHaveLength(2);
  });

  it("removes control characters from the wording", () => {
    expect(renderBookedMessage("נקבע\u0007 תור\r\n{link}", vars())).toBe(`נקבע תור\n${LINK}`);
  });
});

describe("validateTemplate", () => {
  it("accepts a normal wording and cleans it", () => {
    const r = validateTemplate("  שלום {name}!\r\nנקבע לך תור ל{business} {link}  ");
    expect(r).toEqual({ ok: true, template: "שלום {name}!\nנקבע לך תור ל{business} {link}" });
  });

  it("rejects an unknown variable with a clear message", () => {
    const r = validateTemplate("שלום {firstname}");
    expect(r).toEqual({ ok: false, error: "משתנה לא מוכר: {firstname}" });
    expect(validateTemplate("שלום {}").ok).toBe(false);
  });

  it("rejects stray braces", () => {
    expect(validateTemplate("שלום { {name}").ok).toBe(false);
    expect(validateTemplate("שלום name} {link}").ok).toBe(false);
  });

  it.each([
    "הנחה! https://shop.example.com {link}",
    "http://evil.test",
    "www.example.com",
    "היכנסו ל-example.co.il {link}",
    "bit.ly/abc {link}",
    "info@example.com",
  ])("rejects a foreign link or address: %s", (t) => {
    const r = validateTemplate(t);
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.error).toMatch(/קישורים/);
  });

  it("does not mistake normal text, dates and times for addresses", () => {
    for (const t of ["נקבע ב-05/11 בשעה 15:30. {link}", "ת.ז. {link}", "Barber Dan. תודה {link}", "שעה 10.30 {link}"]) {
      expect(validateTemplate(t).ok).toBe(true);
    }
  });

  it("rejects an empty or too long wording", () => {
    expect(validateTemplate("  ").ok).toBe(false);
    expect(validateTemplate("א".repeat(SMS_TEMPLATE_MAX_RAW)).ok).toBe(true);
    expect(validateTemplate("א".repeat(SMS_TEMPLATE_MAX_RAW + 1)).ok).toBe(false);
    expect(validateTemplate(42).ok).toBe(false);
  });
});

describe("a saved wording that is no longer valid never stops the message", () => {
  const defaultText = renderBookedMessage(null, vars());

  it.each([
    ["a foreign URL", "מבצע! https://evil.test {link}"],
    ["an unknown variable", "שלום {firstname} {link}"],
    ["over the length", "א".repeat(SMS_TEMPLATE_MAX_RAW + 50)],
    ["stray braces", "שלום {name {link}"],
  ])("%s -> the default wording and a fallback flag", (_label, bad) => {
    const r = renderBookedMessageDetailed(bad, vars());
    expect(r.fellBack).toBe(true);
    expect(r.fallbackReason).toBeTruthy();
    expect(r.text).toBe(defaultText);
    expect(r.text.endsWith(LINK)).toBe(true);
  });

  it("the reason never contains customer data", () => {
    const r = renderBookedMessageDetailed("שלום {name} https://evil.test", vars({ name: "דנה כהן 0501234567" }));
    expect(JSON.stringify(r.fallbackReason)).not.toMatch(/דנה|0501234567/);
  });

  it("a wording that is valid but too long once filled in falls back as well", () => {
    // 240 characters of text + a 100-character business name is more than 4 segments
    const wording = `${"א".repeat(240)} {business} {link}`;
    const r = renderBookedMessageDetailed(wording, vars({ business: "ב".repeat(100) }));
    expect(r.fellBack).toBe(true);
    expect(r.fallbackReason).toBe("too_long_when_rendered");
    expect(r.text).toBe(renderBookedMessage(null, vars({ business: "ב".repeat(100) })));
  });

  it("a custom wording is used when it is fine", () => {
    const r = renderBookedMessageDetailed("היי {name}, ב-{date} ב-{time} ב{business}. {link}", vars());
    expect(r.fellBack).toBe(false);
    expect(r.text).toBe(`היי דנה, ב-05/11 ב-15:30 בסלון נועה. ${LINK}`);
  });
});

describe("countSegments", () => {
  it("Hebrew (unicode): 70 for a single message, 67 per part after that", () => {
    expect(countSegments("א".repeat(70))).toEqual({ length: 70, segments: 1, unicode: true });
    expect(countSegments("א".repeat(71)).segments).toBe(2);
    expect(countSegments("א".repeat(134)).segments).toBe(2);
    expect(countSegments("א".repeat(135)).segments).toBe(3);
    expect(countSegments("א".repeat(201)).segments).toBe(3);
    expect(countSegments("א".repeat(202)).segments).toBe(4);
    expect(countSegments("א".repeat(268)).segments).toBe(4);
    expect(countSegments("א".repeat(269)).segments).toBe(5);
  });

  it("Latin only (GSM-7): 160 for a single message, 153 per part after that", () => {
    expect(countSegments("a".repeat(160))).toEqual({ length: 160, segments: 1, unicode: false });
    expect(countSegments("a".repeat(161)).segments).toBe(2);
    expect(countSegments("a".repeat(306)).segments).toBe(2);
    expect(countSegments("a".repeat(307)).segments).toBe(3);
  });

  it("a single Hebrew letter makes the whole message unicode", () => {
    expect(countSegments(`${"a".repeat(70)}א`)).toMatchObject({ unicode: true, length: 71, segments: 2 });
  });

  it("an emoji counts as 2 (UTF-16 units) and makes it unicode", () => {
    const r = countSegments("😀");
    expect(r).toMatchObject({ length: 2, unicode: true, segments: 1 });
    expect(countSegments("😀".repeat(35)).segments).toBe(1); // 70 units
    expect(countSegments("😀".repeat(36)).segments).toBe(2); // 72 units
  });

  it("GSM extension characters count twice", () => {
    expect(countSegments("{".repeat(80)).segments).toBe(1); // 160 septets
    expect(countSegments("{".repeat(81)).segments).toBe(2); // 162
  });

  it("empty text is 0 segments", () => {
    expect(countSegments("")).toEqual({ length: 0, segments: 0, unicode: false });
  });
});

describe("worst-case length check (saving)", () => {
  const ctx = { businessName: "סלון נועה", longestServiceName: "תספורת גברים קלאסית", siteUrl: "https://tornow-eight.vercel.app" };

  it("accepts the default and a normal wording", () => {
    expect(checkWorstCaseLength(DEFAULT_BOOKED_TEMPLATE, ctx)).toBeNull();
    expect(
      checkWorstCaseLength("שלום {name}, נקבע לך תור ל{business} ב-{date} בשעה {time}.\nלשינוי או ביטול: {link}", ctx)
    ).toBeNull();
  });

  it("accepts the default even for the longest possible business name", () => {
    expect(checkWorstCaseLength(DEFAULT_BOOKED_TEMPLATE, { ...ctx, businessName: "ע".repeat(120) })).toBeNull();
  });

  it("rejects a wording that gets too long with the longest names", () => {
    const long = `${"א".repeat(120)} {name} {business} {service} {link}`;
    expect(checkWorstCaseLength(long, ctx)).toMatch(/ארוכה מדי/);
  });

  it("counts the link that is added automatically", () => {
    expect(checkWorstCaseLength("א".repeat(220), ctx)).toMatch(/ארוכה מדי/);
    expect(checkWorstCaseLength("א".repeat(150), ctx)).toBeNull();
  });
});

describe("previewVars", () => {
  it("builds a link of the real length", () => {
    expect(previewVars({ siteUrl: "https://tornow-eight.vercel.app" }).link).toHaveLength(66);
  });
});

describe("shouldSendSms / getSmsTemplate", () => {
  it("a missing setting means send (existing businesses keep their confirmations)", () => {
    expect(shouldSendSms({ settings: {} }, "booked")).toBe(true);
    expect(shouldSendSms({}, "booked")).toBe(true);
    expect(shouldSendSms(null, "booked")).toBe(true);
    expect(shouldSendSms({ settings: { sms_confirmation_enabled: true } }, "booked")).toBe(true);
  });
  it("false switches it off", () => {
    expect(shouldSendSms({ settings: { sms_confirmation_enabled: false } }, "booked")).toBe(false);
    expect(SKIP_BUSINESS_DISABLED).toBe("business_disabled");
  });
  it("hands out the business's wording, or nothing for the default", () => {
    expect(getSmsTemplate({ settings: { sms_confirmation_template: "תור {date} {link}" } }, "booked")).toBe("תור {date} {link}");
    expect(getSmsTemplate({ settings: { sms_confirmation_template: "  " } }, "booked")).toBeUndefined();
    expect(getSmsTemplate({ settings: {} }, "booked")).toBeUndefined();
    expect(getSmsTemplate(undefined, "booked")).toBeUndefined();
  });
});
