import { formatShortDate, formatTime } from "@/lib/utils";

/**
 * The wording of the SMS messages. Edit the text here.
 *
 * Service content only: no offers, no promotion, no emojis (a transactional message,
 * not an advertisement under section 30A of the Communications Law).
 */

export interface BookedMessageInput {
  /** May be empty: the greeting is then left out. */
  firstName?: string | null;
  businessName?: string | null;
  serviceName?: string | null;
  /** The appointment start (ISO string or Date). Shown in Israel time. */
  start: string | Date;
  manageUrl: string;
}

export function buildBookedMessage(input: BookedMessageInput): string {
  const name = input.firstName?.trim();
  const place = input.businessName?.trim() || input.serviceName?.trim() || "";
  const date = formatShortDate(input.start);
  const time = formatTime(input.start);

  const what = place ? `נקבע לך תור ל${place}` : "נקבע לך תור";
  const body = `${what} בתאריך ${date} בשעה ${time}.`;
  const greeting = name ? `שלום ${name}, ` : "";

  return `${greeting}${body}\nלשינוי או ביטול:\n${input.manageUrl}`;
}

/** Link to the public manage page. The base comes from NEXT_PUBLIC_SITE_URL (never hardcoded). */
export function buildManageUrl(token: string, siteUrl: string | undefined = process.env.NEXT_PUBLIC_SITE_URL): string | null {
  const base = siteUrl?.trim().replace(/\/+$/, "");
  if (!base || !/^https?:\/\//i.test(base)) return null;
  return `${base}/t/${token}`;
}
