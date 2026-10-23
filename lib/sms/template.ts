/**
 * The manage link. The wording of the messages lives in lib/sms/message.ts
 * (default text, the template language the business owner can edit, rendering).
 */

/** Link to the public manage page. The base comes from NEXT_PUBLIC_SITE_URL (never hardcoded). */
export function buildManageUrl(token: string, siteUrl: string | undefined = process.env.NEXT_PUBLIC_SITE_URL): string | null {
  const base = siteUrl?.trim().replace(/\/+$/, "");
  if (!base || !/^https?:\/\//i.test(base)) return null;
  return `${base}/t/${token}`;
}
