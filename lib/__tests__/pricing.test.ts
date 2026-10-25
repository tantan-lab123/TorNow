import { describe, expect, it } from "vitest";
import {
  FAQ,
  FEATURES,
  LAUNCH_BANNER,
  PLANS,
  PRICES_INCLUDE_VAT,
  PRICING_COPY,
  SIGNUP_HREF,
  VAT_NOTE,
  formatPrice,
  planCardFeatures,
  type PlanId,
} from "@/lib/pricing";

/** Every piece of text on the pricing page, as one list. */
function allTexts(): string[] {
  const texts: string[] = [LAUNCH_BANNER, VAT_NOTE];
  for (const plan of PLANS) texts.push(plan.name, plan.audience, formatPrice(plan.price));
  for (const feature of FEATURES) {
    texts.push(feature.label);
    for (const v of Object.values(feature.values)) if (typeof v === "string") texts.push(v);
  }
  for (const item of FAQ) texts.push(item.question, item.answer);
  for (const value of Object.values(PRICING_COPY)) texts.push(typeof value === "function" ? value("תוכנית") : value);
  for (const plan of PLANS) texts.push(...planCardFeatures(plan.id).lines);
  return texts;
}

describe("the plans", () => {
  it("there are exactly three", () => {
    expect(PLANS).toHaveLength(3);
  });

  it("ids are unique and names are not empty", () => {
    expect(new Set(PLANS.map((p) => p.id)).size).toBe(3);
    for (const p of PLANS) expect(p.name.trim()).not.toBe("");
  });

  it("exactly one is free", () => {
    expect(PLANS.filter((p) => p.price === 0)).toHaveLength(1);
    expect(PLANS[0].price).toBe(0);
  });

  it("exactly one is highlighted, and it is the middle one", () => {
    const highlighted = PLANS.filter((p) => p.highlighted);
    expect(highlighted).toHaveLength(1);
    expect(highlighted[0]).toBe(PLANS[1]);
  });

  it("prices are whole non-negative shekels and strictly increasing", () => {
    for (const p of PLANS) {
      expect(Number.isInteger(p.price)).toBe(true);
      expect(p.price).toBeGreaterThanOrEqual(0);
    }
    for (let i = 1; i < PLANS.length; i++) expect(PLANS[i].price).toBeGreaterThan(PLANS[i - 1].price);
  });

  it("the free plan shows as 'חינם' and the others with the shekel sign", () => {
    expect(formatPrice(0)).toBe("חינם");
    expect(formatPrice(49)).toBe("₪49");
  });
});

describe("the texts", () => {
  it("none is empty", () => {
    for (const text of allTexts()) expect(text.trim().length, JSON.stringify(text)).toBeGreaterThan(0);
  });

  it("every feature has a value for every plan", () => {
    const ids = PLANS.map((p) => p.id);
    for (const feature of FEATURES) {
      expect(Object.keys(feature.values).sort()).toEqual([...ids].sort());
      for (const id of ids) {
        const v = feature.values[id];
        expect(typeof v === "boolean" || (typeof v === "string" && v.trim() !== "")).toBe(true);
      }
    }
    expect(new Set(FEATURES.map((f) => f.label)).size).toBe(FEATURES.length);
  });

  it("no unbuilt feature slips in: WhatsApp, campaigns, the cash register", () => {
    const banned = ["וואטסאפ", "ווטסאפ", "whatsapp", "קמפיין", "קופה"];
    for (const text of allTexts()) {
      for (const word of banned) expect(text.toLowerCase(), `"${text}" has "${word}"`).not.toContain(word);
    }
  });

  it("no invented numbers of SMS, no discounts, no urgency, no 'trusted by' claims", () => {
    const banned = ["הנחה", "מבצע", "אחרונים", "מוגבל בזמן", "אלפי עסקים", "עסקים סומכים", "לקוחות מרוצים", "% "];
    for (const text of allTexts()) {
      for (const word of banned) expect(text, `"${text}" has "${word}"`).not.toContain(word);
    }
  });

  it("the launch banner is the agreed sentence", () => {
    expect(LAUNCH_BANNER).toBe(
      "בתקופת ההשקה כל התכונות פתוחות לכולם בחינם. התוכניות המשולמות יתחילו רק אחרי הודעה מראש."
    );
  });

  it("the VAT note follows the one flag", () => {
    expect(VAT_NOTE).toBe(PRICES_INCLUDE_VAT ? "המחירים כוללים מע״מ" : "המחירים אינם כוללים מע״מ");
    expect(PRICES_INCLUDE_VAT).toBe(true);
  });

  it("every call to action goes to the sign-up screen", () => {
    expect(SIGNUP_HREF).toBe("/admin?new=1");
    expect(PRICING_COPY.ctaFree).toBe("התחילו בחינם");
    expect(PRICING_COPY.ctaPaid).toBe("נסו בחינם");
  });

  it("the FAQ has 4 to 5 questions", () => {
    expect(FAQ.length).toBeGreaterThanOrEqual(4);
    expect(FAQ.length).toBeLessThanOrEqual(5);
  });
});

describe("the feature matrix and the cards", () => {
  const ids = PLANS.map((p) => p.id);

  it("a higher plan has everything the plan before it has (the cards say 'everything in the previous plan')", () => {
    for (let i = 1; i < ids.length; i++) {
      for (const feature of FEATURES) {
        const before = feature.values[ids[i - 1]];
        const now = feature.values[ids[i]];
        if (before !== false) expect(now, `${feature.label} / ${ids[i]}`).not.toBe(false);
      }
    }
  });

  it("the free card lists everything the free plan has", () => {
    const { inheritsFrom, lines } = planCardFeatures("free");
    expect(inheritsFrom).toBeNull();
    expect(lines).toEqual(
      FEATURES.filter((f) => f.values.free !== false).map((f) => (f.values.free === true ? f.label : `${f.label}: ${f.values.free}`))
    );
  });

  it("the cards together list exactly what the table shows (nothing is left out or made up)", () => {
    const fromCards = (id: PlanId) => {
      const lines: string[] = [];
      for (const plan of PLANS) {
        lines.push(...planCardFeatures(plan.id).lines);
        if (plan.id === id) break;
      }
      return lines;
    };
    for (const id of ids) {
      const inTable = FEATURES.filter((f) => f.values[id] !== false).map((f) => f.label);
      const labelsFromCards = fromCards(id).map((l) => l.split(": ")[0]);
      expect([...new Set(labelsFromCards)].sort()).toEqual([...inTable].sort());
    }
  });

  it("a paid card only lists what is new, and says which plan the rest comes from", () => {
    const pro = planCardFeatures("pro");
    expect(pro.inheritsFrom?.id).toBe("free");
    expect(pro.lines).toContain("תזכורת SMS לפני התור");
    expect(pro.lines).not.toContain("רשימת המתנה"); // already in the free plan
    expect(PRICING_COPY.inherits("חינם")).toBe("הכול בחינם, ועוד:");
  });

  it("the limits are written out: employees go from one to three to unlimited", () => {
    const employees = FEATURES.find((f) => f.label === "עובדים")!;
    expect(employees.values).toEqual({ free: "עד עובד אחד", pro: "עד 3 עובדים", business: "ללא הגבלה" });
  });
});
