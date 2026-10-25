import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_BOOKED_TEMPLATE,
  DEFAULT_REMINDER_TEMPLATE,
  SMS_CHARS_PER_BILLED_MESSAGE,
  SMS_SEGMENTS_MAX,
  SMS_LINK_LENGTH_FALLBACK,
  SMS_TEMPLATE_MAX_RAW,
  analyzeTemplate,
  billedMessages,
  checkWorstCaseLength,
  countSegments,
  manageLinkLength,
  previewVars,
  renderBookedMessage,
  renderBookedMessageDetailed,
  renderSmsMessageDetailed,
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

describe("billedMessages: what 019 bills", () => {
  it("the constant is 201 characters per billed message", () => {
    expect(SMS_CHARS_PER_BILLED_MESSAGE).toBe(201);
  });

  // Checked by hand in the 019 panel with Hebrew text: 201 = 1, 202 = 2, 402 = 2, 403 = 3.
  it.each([
    [0, 0],
    [1, 1],
    [70, 1],
    [71, 1],
    [134, 1],
    [135, 1],
    [201, 1],
    [202, 2],
    [268, 2],
    [402, 2],
    [403, 3],
  ])("%i Hebrew characters are %i billed message(s)", (length, billed) => {
    expect(billedMessages("א".repeat(length))).toBe(billed);
  });

  // NOT checked in the 019 panel: 603 and 604 follow the same rule (ceil(length / 201)), nobody has confirmed them.
  it.each([
    [603, 3],
    [604, 4],
  ])("(unconfirmed, same rule) %i characters are %i", (length, billed) => {
    expect(billedMessages("א".repeat(length))).toBe(billed);
  });

  it("counts UTF-16 units (an emoji is 2); how 019 counts an emoji is not checked", () => {
    expect(billedMessages("😀".repeat(100))).toBe(1); // 200 units
    expect(billedMessages("😀".repeat(101))).toBe(2); // 202 units
  });

  it("the same rule for Latin-only text (not checked against 019 either)", () => {
    expect(billedMessages("a".repeat(201))).toBe(1);
    expect(billedMessages("a".repeat(202))).toBe(2);
  });

  it("billing no longer follows the carrier segments: 201 characters are 3 segments but 1 billed message", () => {
    const text = "א".repeat(201);
    expect(countSegments(text).segments).toBe(3);
    expect(billedMessages(text)).toBe(1);
  });

  it("the default confirmation and the default reminder are each exactly one billed message", () => {
    const booked = renderSmsMessageDetailed("booked", null, vars());
    const reminder = renderSmsMessageDetailed("reminder", null, vars());
    expect(booked.text.length).toBe(123);
    expect(billedMessages(booked.text)).toBe(1);
    expect(billedMessages(reminder.text)).toBe(1);
    // also with a longer, still normal, business name
    expect(billedMessages(renderSmsMessageDetailed("booked", null, vars({ business: "ב".repeat(30) })).text)).toBe(1);
    expect(billedMessages(renderSmsMessageDetailed("reminder", null, vars({ business: "ב".repeat(30) })).text)).toBe(1);
    expect(DEFAULT_REMINDER_TEMPLATE).toContain("{link}");
  });
});

describe("the editor hint follows the billed messages of the worst case", () => {
  // no variables in the wording: the worst case is N characters + a space + the 66-character fallback link
  const wording = (n: number) => `${"א".repeat(n)} {link}`;

  it("201 characters in the worst case: one message, no warning", () => {
    const a = analyzeTemplate("booked", wording(134));
    expect(a.worst).toEqual({ length: 201, billed: 1 });
    expect(a.warn).toBe(false);
  });

  it("202 characters in the worst case: counted as 2 messages, with a warning", () => {
    const a = analyzeTemplate("booked", wording(135));
    expect(a.worst).toEqual({ length: 202, billed: 2 });
    expect(a.warn).toBe(true);
    expect(a.error).toBeNull(); // only a warning: the wording can still be saved
  });

  it("the worst case, not the example: a wording with {name} is judged with the longest first name", () => {
    const text = "שלום {name}, תור ב-{date}. {link}";
    const a = analyzeTemplate("booked", text);
    expect(a.worst.length).toBeGreaterThan(a.info.length); // the 60-letter name vs the example "דנה"
  });

  it("the default wordings are one message in the worst case too", () => {
    expect(analyzeTemplate("booked", DEFAULT_BOOKED_TEMPLATE, { businessName: "סלון נועה" }).worst.billed).toBe(1);
    expect(analyzeTemplate("reminder", DEFAULT_REMINDER_TEMPLATE, { businessName: "סלון נועה" }).worst.billed).toBe(1);
  });

  it("the hard limit and the saved-template validation are unchanged: more than 4 segments is an error", () => {
    expect(SMS_SEGMENTS_MAX).toBe(4);
    expect(checkWorstCaseLength("א".repeat(220), { businessName: "x", longestServiceName: "y" })).toMatch(/ארוכה מדי/);
    expect(validateTemplate("א".repeat(SMS_TEMPLATE_MAX_RAW + 1)).ok).toBe(false);
  });

  it("the old 'more than 2 segments' warning is gone; the editor speaks in messages", () => {
    const editor = readFileSync("components/admin/SmsTemplateEditor.tsx", "utf8");
    expect(editor).not.toContain("SMS_SEGMENTS_WARN");
    expect(editor).toContain("הודעה אחת");
    expect(editor).toContain("ההודעה תיספר כ-");
    expect(editor).toContain("תווים");
    expect(readFileSync("lib/sms/message.ts", "utf8")).not.toContain("SMS_SEGMENTS_WARN");
  });
});
