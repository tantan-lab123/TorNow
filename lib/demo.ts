/**
 * The demo businesses: booking pages prospective customers use to try the product.
 * They must never send an SMS (confirmation, reminder, anything), whatever their settings say.
 *
 * One list for everybody: the landing page links these, the SMS rules refuse them.
 */
export const DEMO_BUSINESS_SLUGS = ["barber-dan", "maya-nails", "clinic-rafael"];

/** The ids the two main demos are known by (a slug can be renamed, an id cannot). */
export const DEMO_BUSINESS_IDS = [
  "a1111111-1111-1111-1111-111111111111", // barber-dan
  "b2222222-2222-2222-2222-222222222222", // maya-nails
];

/** True for a demo business, matched by slug or by one of the known ids. */
export function isDemoBusiness(business: { id?: string | null; slug?: string | null } | null | undefined): boolean {
  if (!business) return false;
  if (business.slug && DEMO_BUSINESS_SLUGS.includes(business.slug)) return true;
  if (business.id && DEMO_BUSINESS_IDS.includes(business.id)) return true;
  return false;
}
