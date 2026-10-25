import { formatShortDate, formatTime } from "@/lib/utils";

/**
 * The confirmation SMS text: the default wording, the template language the business owner
 * can edit, validation, rendering and the SMS length / segment count.
 *
 * Pure and safe to import from the browser (the settings screen uses it for the live preview).
 * Service content only: no offers, no promotion (a transactional message, not an advertisement
 * under section 30A of the Communications Law).
 */

// ------------------------------------------------------------------ template language

export const SMS_VARIABLES = ["name", "business", "service", "date", "time", "link"] as const;
export type SmsVariable = (typeof SMS_VARIABLES)[number];

/** What the owner sees on the variable chips. */
export const SMS_VARIABLE_LABELS: Record<SmsVariable, string> = {
  name: "שם הלקוח",
  business: "שם העסק",
  service: "שירות",
  date: "תאריך",
  time: "שעה",
  link: "קישור לניהול התור",
};

/** Short on purpose: with a real manage link it fits in two SMS segments. */
export const DEFAULT_BOOKED_TEMPLATE = "נקבע לך תור ל{business} ב-{date} בשעה {time}.\nלשינוי/ביטול: {link}";

/** Reminder before the appointment. Also short enough for two segments with the real link. */
export const DEFAULT_REMINDER_TEMPLATE = "תזכורת לתור ב{business}: {date} בשעה {time}.\nלשינוי/ביטול: {link}";

/** The messages whose wording the owner can edit. */
export type SmsTemplateKind = "booked" | "reminder";

export function defaultTemplateFor(kind: SmsTemplateKind): string {
  return kind === "reminder" ? DEFAULT_REMINDER_TEMPLATE : DEFAULT_BOOKED_TEMPLATE;
}

/** When the reminder goes out, in minutes before the appointment. 0 = never (the default). */
export const SMS_REMINDER_OPTIONS: { minutes: number; label: string }[] = [
  { minutes: 0, label: "אף פעם" },
  { minutes: 15, label: "15 דקות" },
  { minutes: 30, label: "30 דקות" },
  { minutes: 60, label: "שעה" },
  { minutes: 120, label: "שעתיים" },
  { minutes: 1440, label: "יום לפני" },
];

/** A stored value that is not one of the options means "never". */
export function normalizeReminderMinutes(v: unknown): number {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN;
  return SMS_REMINDER_OPTIONS.some((o) => o.minutes === n) ? n : 0;
}

/** Longest template the owner may save (before the variables are filled in). */
export const SMS_TEMPLATE_MAX_RAW = 300;
/** More than this many carrier segments is not allowed (the warning is in billed messages, see billedMessages). */
export const SMS_SEGMENTS_MAX = 4;
/** First names are limited to this by the booking form. */
export const SMS_MAX_FIRST_NAME = 60;
/** /t/ + a 32-character token */
const MANAGE_PATH_LENGTH = 3 + 32;
/** Length of the real link when NEXT_PUBLIC_SITE_URL is not known (https://tornow-eight.vercel.app/t/<32>) */
export const SMS_LINK_LENGTH_FALLBACK = 66;

export function manageLinkLength(siteUrl: string | undefined): number {
  const base = siteUrl?.trim().replace(/\/+$/, "");
  return base ? base.length + MANAGE_PATH_LENGTH : SMS_LINK_LENGTH_FALLBACK;
}

/** Control characters and CR removed, outer whitespace trimmed. Newlines stay. */
export function cleanTemplateText(raw: string): string {
  return raw
    .replace(/\r/g, "")
    .replace(new RegExp("[\u0000-\u0009\u000B-\u001F\u007F\u0080-\u009F\u2028\u2029]", "g"), "")
    .trim();
}

// anything that looks like an address: a scheme, www., or name.tld
const URL_LIKE = /(https?:|ftp:|www\.)|\b[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}\b/i;

export type TemplateCheck = { ok: true; template: string } | { ok: false; error: string };

/**
 * Is this wording allowed? (Same rules on the server when saving, and again when sending.)
 * The only link a message may contain is the system's own, {link}.
 */
export function validateTemplate(raw: unknown): TemplateCheck {
  if (typeof raw !== "string") return { ok: false, error: "נוסח ההודעה לא תקין" };
  const template = cleanTemplateText(raw);
  if (!template) return { ok: false, error: "נוסח ההודעה ריק" };
  if (template.length > SMS_TEMPLATE_MAX_RAW) {
    return { ok: false, error: `נוסח ההודעה ארוך מדי (עד ${SMS_TEMPLATE_MAX_RAW} תווים)` };
  }

  for (const m of template.matchAll(/\{([^{}]*)\}/g)) {
    if (!(SMS_VARIABLES as readonly string[]).includes(m[1])) {
      return { ok: false, error: `משתנה לא מוכר: {${m[1]}}` };
    }
  }
  // a brace that is not part of a variable
  if (/[{}]/.test(template.replace(/\{[^{}]*\}/g, ""))) {
    return { ok: false, error: "סוגריים מסולסלים מותרים רק עבור משתנים, למשל {name}" };
  }

  if (URL_LIKE.test(template.replace(/\{[^{}]*\}/g, " "))) {
    return { ok: false, error: "אסור לכלול קישורים או כתובות אתר בהודעה. הקישור היחיד המותר הוא {link}" };
  }
  return { ok: true, template };
}

// ------------------------------------------------------------------ rendering

export interface SmsVars {
  name?: string | null;
  business?: string | null;
  service?: string | null;
  /** "05/11" */
  date: string;
  /** "15:30" */
  time: string;
  link: string;
}

const GREETING_WORDS = "(?:שלום רב|שלום|היי|הי|בוקר טוב|ערב טוב|צהריים טובים)";

/** Variables in, text out. Leftovers of an empty variable are cleaned up. */
export function renderTemplate(template: string, vars: SmsVars): string {
  let t = template;
  const has = (v?: string | null) => !!v && v.trim().length > 0;

  // no first name: drop the greeting that belonged to it ("שלום {name}, ")
  if (!has(vars.name)) {
    t = t.replace(new RegExp(`${GREETING_WORDS}[ \\t]+\\{name\\}[ \\t]*[,:!.-]?[ \\t]*`, "g"), "");
  }
  // an empty business / service: drop the one-letter preposition stuck to it ("ל{business}")
  for (const key of ["business", "service"] as const) {
    if (!has(vars[key])) t = t.replace(new RegExp(`[ \\t]?[לבמ]-?\\{${key}\\}`, "g"), "");
  }

  t = t.replace(/\{(name|business|service|date|time|link)\}/g, (_m, key: SmsVariable) => {
    const v = vars[key];
    return typeof v === "string" ? (key === "link" ? v : v.trim()) : "";
  });

  return t
    .split("\n")
    .map((line) =>
      line
        .replace(/\(\s*\)/g, "")
        .replace(/[ \t]{2,}/g, " ")
        .replace(/[ \t]+([,.:;!?])/g, "$1")
        .replace(/^[,:;]+\s*/, "") // punctuation left at the start of a line by an empty variable
        .trim()
    )
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export interface RenderedMessage {
  text: string;
  /** The saved wording was not usable and the default was used instead. */
  fellBack: boolean;
  /** Why (a code, never customer data) */
  fallbackReason?: string;
}

/**
 * The finished SMS. The template (usually from the business settings) is checked again here:
 * an old, hand-edited or otherwise broken one never stops a confirmation, it falls back to the
 * default wording. The manage link is always present: it is added at the end when the wording
 * has no {link}, and nothing ever shortens it.
 */
export function renderBookedMessageDetailed(template: string | null | undefined, vars: SmsVars): RenderedMessage {
  return renderSmsMessageDetailed("booked", template, vars);
}

/** Same as above for any kind of message: each kind has its own default wording. */
export function renderSmsMessageDetailed(
  kind: SmsTemplateKind,
  template: string | null | undefined,
  vars: SmsVars
): RenderedMessage {
  const wanted = typeof template === "string" && template.trim() !== "" ? template : null;
  const fallbackTemplate = defaultTemplateFor(kind);

  let chosen = fallbackTemplate;
  let fellBack = false;
  let fallbackReason: string | undefined;

  if (wanted !== null) {
    const check = validateTemplate(wanted);
    if (check.ok) {
      chosen = check.template;
    } else {
      fellBack = true;
      fallbackReason = check.error;
    }
  }

  const withLink = (t: string) => (t.includes("{link}") ? t : `${t}\n{link}`);
  let text = renderTemplate(withLink(chosen), vars);

  // too long once filled in: the default instead (a long business name can make a saved text too long)
  if (!fellBack && wanted !== null && countSegments(text).segments > SMS_SEGMENTS_MAX) {
    fellBack = true;
    fallbackReason = "too_long_when_rendered";
    text = renderTemplate(fallbackTemplate, vars);
  }
  return { text, fellBack, fallbackReason };
}

export function renderBookedMessage(template: string | null | undefined, vars: SmsVars): string {
  return renderBookedMessageDetailed(template, vars).text;
}

/** Date and time variables for an appointment start, in Israel time. */
export function dateTimeVars(start: string | Date): Pick<SmsVars, "date" | "time"> {
  return { date: formatShortDate(start), time: formatTime(start) };
}

// ------------------------------------------------------------------ length and segments

const GSM_BASIC =
  "@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !\"#¤%&'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà";
const GSM_EXTENDED = "^{}\\[~]|€\f";

export interface SegmentInfo {
  /** Length that counts for the limit: UTF-16 units (an emoji is 2), or GSM-7 septets */
  length: number;
  segments: number;
  /** Any character outside GSM-7 (every Hebrew letter): 70 / 67 per segment instead of 160 / 153 */
  unicode: boolean;
}

export function countSegments(text: string): SegmentInfo {
  if (text.length === 0) return { length: 0, segments: 0, unicode: false };
  let gsmLength = 0;
  let unicode = false;
  for (const ch of text) {
    if (GSM_BASIC.includes(ch)) gsmLength += 1;
    else if (GSM_EXTENDED.includes(ch)) gsmLength += 2;
    else {
      unicode = true;
      break;
    }
  }
  if (unicode) {
    const length = text.length; // UTF-16 units
    return { length, segments: length <= 70 ? 1 : Math.ceil(length / 67), unicode: true };
  }
  return { length: gsmLength, segments: gsmLength <= 160 ? 1 : Math.ceil(gsmLength / 153), unicode: false };
}

// ------------------------------------------------------------------ what 019 bills

/**
 * Characters in one message as 019 bills it. Checked by hand in the 019 panel with Hebrew text: up to 201
 * characters = 1 billed message, 202 = 2, 402 = 2, 403 = 3.
 */
export const SMS_CHARS_PER_BILLED_MESSAGE = 201;

/**
 * How many messages 019 bills for this text: ceil(length / 201), at least 1 for any text, 0 for none.
 * This, not the carrier segments above, is the number the money follows.
 * Length is UTF-16 units (text.length), so an emoji counts 2. We have not checked how 019 counts an emoji,
 * and the same rule is applied to every text for now, Latin-only ones included.
 */
export function billedMessages(text: string): number {
  if (text.length === 0) return 0;
  return Math.ceil(text.length / SMS_CHARS_PER_BILLED_MESSAGE);
}

// ------------------------------------------------------------------ worst case at save time

export interface WorstCaseContext {
  /** The business's real name and its longest service name: what the message really contains. */
  businessName: string;
  longestServiceName: string;
  siteUrl?: string;
}

/** The longest message this wording can produce for this business. */
export function worstCaseVars(ctx: WorstCaseContext): SmsVars {
  return {
    name: "א".repeat(SMS_MAX_FIRST_NAME),
    business: ctx.businessName,
    service: ctx.longestServiceName,
    date: "00/00",
    time: "00:00",
    link: "x".repeat(manageLinkLength(ctx.siteUrl)),
  };
}

/** Error text when the wording can get longer than the limit for this business, else null. */
export function checkWorstCaseLength(template: string, ctx: WorstCaseContext): string | null {
  const withLink = template.includes("{link}") ? template : `${template}\n{link}`;
  const worst = countSegments(renderTemplate(withLink, worstCaseVars(ctx)));
  if (worst.segments > SMS_SEGMENTS_MAX) {
    return `ההודעה עלולה להיות ארוכה מדי (עד ${SMS_SEGMENTS_MAX} מקטעים) כששם הלקוח, שם העסק והשירות הם הארוכים ביותר. קצרו את הנוסח.`;
  }
  return null;
}

/** Example values for the live preview. */
export function previewVars(opts: { businessName?: string; siteUrl?: string; link?: string }): SmsVars {
  const link = opts.link ?? `${(opts.siteUrl ?? "https://tornow-eight.vercel.app").replace(/\/+$/, "")}/t/${"x".repeat(32)}`;
  return {
    name: "דנה",
    business: opts.businessName?.trim() || "סלון נועה",
    service: "תספורת",
    date: "05/11",
    time: "15:30",
    link,
  };
}

// ------------------------------------------------------------------ what the settings screen shows

export interface TemplateAnalysis {
  check: TemplateCheck;
  /** The message as it would go out, with example data (the default wording while the text is invalid). */
  rendered: RenderedMessage;
  info: SegmentInfo;
  /** Characters and billed messages of the LONGEST message this wording can produce (longest name, service, ...). */
  worst: { length: number; billed: number };
  /** The wording can be billed as more than one message (worst case) */
  warn: boolean;
  tooLong: boolean;
  /** What stops the owner from saving, or null */
  error: string | null;
  /** The text is exactly the default wording (it is then saved as "no custom wording") */
  isDefault: boolean;
}

/** The settings screen does not know the services: this long a service name is assumed for the worst case. */
const ASSUMED_LONGEST_SERVICE = "x".repeat(30);

/** Everything the editor shows about one wording: validity, live preview, length, billed messages and segments. */
export function analyzeTemplate(
  kind: SmsTemplateKind,
  text: string,
  opts: { businessName?: string; siteUrl?: string; longestServiceName?: string } = {}
): TemplateAnalysis {
  const check = validateTemplate(text);
  const template = check.ok ? check.template : defaultTemplateFor(kind);
  const rendered = renderSmsMessageDetailed(
    kind,
    template,
    previewVars({ businessName: opts.businessName, siteUrl: opts.siteUrl })
  );
  const info = countSegments(rendered.text);
  const tooLong = info.segments > SMS_SEGMENTS_MAX;
  const worstText = renderTemplate(
    template.includes("{link}") ? template : `${template}\n{link}`,
    worstCaseVars({
      businessName: opts.businessName?.trim() || "סלון נועה",
      longestServiceName: opts.longestServiceName ?? ASSUMED_LONGEST_SERVICE,
      siteUrl: opts.siteUrl,
    })
  );
  const worst = { length: worstText.length, billed: billedMessages(worstText) };
  const warn = worst.billed > 1 && !tooLong;
  const error = !check.ok
    ? check.error
    : tooLong
      ? `ההודעה ארוכה מדי: ${info.segments} מקטעים (המקסימום ${SMS_SEGMENTS_MAX})`
      : null;
  return { check, rendered, info, worst, warn, tooLong, error, isDefault: check.ok && check.template === defaultTemplateFor(kind) };
}
