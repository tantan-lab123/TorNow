/**
 * The pricing page (/pricing): plans, prices and wording, in one place.
 * Edit this file to change a price or a sentence; the page and the tests read from here.
 *
 * Display only: nothing is billed and no plan limit is enforced anywhere in the product yet.
 * Only list features that exist in the product today.
 */

// ---------------------------------------------------------------- prices (shekels per month)

/** Price of the paid plans. Whole shekels, and each plan costs more than the one before it. */
export const PRICE_FREE = 0;
export const PRICE_PRO = 49;
export const PRICE_BUSINESS = 99;

/** true: the prices include VAT. false: they do not. Changes the note under the cards. */
export const PRICES_INCLUDE_VAT = true;

// ---------------------------------------------------------------- wording

export const LAUNCH_BANNER = "בתקופת ההשקה כל התכונות פתוחות לכולם בחינם. התוכניות המשולמות יתחילו רק אחרי הודעה מראש.";

export const VAT_NOTE = PRICES_INCLUDE_VAT ? "המחירים כוללים מע״מ" : "המחירים אינם כוללים מע״מ";

export const PRICING_COPY = {
  title: "מחירון | TorNow",
  description:
    "התחילו בחינם. עמוד הזמנות אישי, SMS אישור לכל תור ויומן בטלפון. בתקופת ההשקה כל התכונות פתוחות לכולם בחינם.",
  heading: "התחילו בחינם. גדלו כשהעסק גדל.",
  intro: "שלוש תוכניות פשוטות, בלי כרטיס אשראי ובלי התחייבות.",
  planLabelHighlight: "הכי פופולרי",
  perMonth: "לחודש",
  free: "חינם",
  ctaFree: "התחילו בחינם",
  ctaPaid: "נסו בחינם",
  headerCta: "התחילו בחינם",
  backToHome: "לעמוד הראשי",
  inherits: (previous: string) => `הכול ב${previous}, ועוד:`,
  comparisonTitle: "השוואה בין התוכניות",
  faqTitle: "שאלות נפוצות",
} as const;

/** Every call to action on the page goes to the sign-up screen. */
export const SIGNUP_HREF = "/admin?new=1";

// ---------------------------------------------------------------- plans

export interface Plan {
  id: "free" | "pro" | "business";
  name: string;
  /** Who it is for */
  audience: string;
  /** Shekels per month; 0 = free */
  price: number;
  /** The plan the page points out */
  highlighted: boolean;
}

export const PLANS: Plan[] = [
  { id: "free", name: "חינם", audience: "לעסק של אדם אחד שרק מתחיל", price: PRICE_FREE, highlighted: false },
  { id: "pro", name: "מקצועי", audience: "לעסק קטן עם צוות ולקוחות קבועים", price: PRICE_PRO, highlighted: true },
  { id: "business", name: "עסק", audience: "לעסק עם צוות גדול שרוצה שליטה מלאה", price: PRICE_BUSINESS, highlighted: false },
];

export type PlanId = Plan["id"];

/** What a plan has in one row: yes, no, or a short text (a limit, for example). */
export type FeatureValue = boolean | string;

export interface Feature {
  label: string;
  values: Record<PlanId, FeatureValue>;
}

/**
 * The feature matrix. The comparison table shows it as it is, and each plan card lists what the plan
 * adds to the one before it, derived from the same rows: the cards and the table cannot disagree.
 */
export const FEATURES: Feature[] = [
  { label: "עמוד הזמנות אישי עם הלוגו והצבע שלכם", values: { free: true, pro: true, business: true } },
  { label: "שירותים ושעות פעילות", values: { free: true, pro: true, business: true } },
  { label: "ניהול לקוחות", values: { free: true, pro: true, business: true } },
  { label: "SMS אישור לכל תור עם קישור לשינוי או לביטול", values: { free: true, pro: true, business: true } },
  { label: "רשימת המתנה", values: { free: true, pro: true, business: true } },
  { label: "עובדים", values: { free: "עד עובד אחד", pro: "עד 3 עובדים", business: "ללא הגבלה" } },
  { label: "תזכורת SMS לפני התור", values: { free: false, pro: true, business: true } },
  { label: "סנכרון ליומן Google", values: { free: false, pro: true, business: true } },
  { label: "התראות לטלפון על תור חדש", values: { free: false, pro: true, business: true } },
  { label: "סטטיסטיקות", values: { free: false, pro: true, business: true } },
  { label: "נוסח הודעות מותאם אישית", values: { free: false, pro: false, business: true } },
  { label: "תמיכה מועדפת", values: { free: false, pro: false, business: true } },
];

const valueOf = (feature: Feature, plan: PlanId) => feature.values[plan];

/** The text of one card line: "label" for a yes, "label: value" for a limit. */
function line(feature: Feature, plan: PlanId): string | null {
  const v = valueOf(feature, plan);
  if (v === false) return null;
  return v === true ? feature.label : `${feature.label}: ${v}`;
}

/**
 * What the plan's card lists. The first plan lists everything it has. Every other plan lists only what
 * is new or better than the plan before it (and the card says "everything in the previous plan, and more").
 */
export function planCardFeatures(planId: PlanId): { inheritsFrom: Plan | null; lines: string[] } {
  const index = PLANS.findIndex((p) => p.id === planId);
  const previous = index > 0 ? PLANS[index - 1] : null;
  const lines: string[] = [];
  for (const feature of FEATURES) {
    const mine = valueOf(feature, planId);
    if (mine === false) continue;
    if (previous && valueOf(feature, previous.id) === mine) continue; // nothing new
    const text = line(feature, planId);
    if (text) lines.push(text);
  }
  return { inheritsFrom: previous, lines };
}

/** "חינם" for 0, else the amount with the shekel sign. */
export function formatPrice(price: number): string {
  return price === 0 ? PRICING_COPY.free : `₪${price}`;
}

// ---------------------------------------------------------------- FAQ

export interface FaqItem {
  question: string;
  answer: string;
}

/** Short and true: nothing here promises something the product does not do. */
export const FAQ: FaqItem[] = [
  {
    question: "צריך כרטיס אשראי כדי להתחיל?",
    answer: "לא. לא מבקשים פרטי תשלום, ובתקופת ההשקה כל התכונות פתוחות בחינם.",
  },
  {
    question: "אפשר לעבור בין תוכניות או לבטל?",
    answer: "בתקופת ההשקה אין תשלום, ולכן אין מה לבטל. התוכניות המשולמות יתחילו רק אחרי הודעה מראש.",
  },
  {
    question: "מה קורה לנתונים שלי אם אעזוב?",
    answer: "אפשר להוריד עותק מלא של התורים, הלקוחות והשירותים ממסך ההגדרות, בכל רגע.",
  },
  {
    question: "הלקוחות שלי משלמים משהו?",
    answer: "לא. הלקוחות קובעים, משנים ומבטלים תור בחינם ובלי להוריד אפליקציה.",
  },
  {
    question: "לאילו טלפונים נשלחים SMS?",
    answer: "למספרי נייד ישראליים. מספרים אחרים לא יקבלו הודעות.",
  },
];
