import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import PricingPage, { metadata } from "@/app/pricing/page";
import sitemap from "@/app/sitemap";
import { FAQ, FEATURES, LAUNCH_BANNER, PLANS, VAT_NOTE } from "@/lib/pricing";

const html = renderToStaticMarkup(createElement(PricingPage));
const count = (re: RegExp) => (html.match(re) ?? []).length;

/** The cards: the markup of each <article> */
const cards = html.split("<article").slice(1).map((chunk) => chunk.split("</article>")[0]);

describe("the pricing page, rendered", () => {
  it("has exactly one h1", () => {
    expect(count(/<h1[\s>]/g)).toBe(1);
  });

  it("shows the launch banner", () => {
    expect(html).toContain(LAUNCH_BANNER);
    expect(html).toContain("בתקופת ההשקה כל התכונות פתוחות לכולם בחינם. התוכניות המשולמות יתחילו רק אחרי הודעה מראש.");
  });

  it("shows the VAT note (one of the two sentences, from the flag)", () => {
    expect(html).toContain(VAT_NOTE);
  });

  it("has three plan cards, each with its own call to action to /admin?new=1", () => {
    expect(cards).toHaveLength(3);
    const labels = cards.map((card) => {
      const m = /<a[^>]*href="\/admin\?new=1"[^>]*>([^<]*)<\/a>/.exec(card);
      expect(m, "a CTA in the card").not.toBeNull();
      return m![1];
    });
    expect(labels).toEqual(["התחילו בחינם", "נסו בחינם", "נסו בחינם"]);
  });

  it("every link to the sign-up screen is /admin?new=1 (the header's too)", () => {
    expect(count(/href="\/admin\?new=1"/g)).toBe(4);
    expect(count(/href="\/admin"/g)).toBe(0);
  });

  it("each card has the plan name, a price and a list with check icons", () => {
    PLANS.forEach((plan, i) => {
      expect(cards[i]).toContain(plan.name);
      expect(cards[i]).toContain("<ul");
      expect(cards[i]).toContain("<svg");
    });
    expect(cards[0]).toContain("חינם");
    expect(cards[1]).toContain("₪49");
    expect(cards[2]).toContain("₪99");
  });

  it("the highlighted plan is marked with text, not only a colour", () => {
    expect(cards[1]).toContain("הכי פופולרי");
    expect(cards[0]).not.toContain("הכי פופולרי");
    expect(cards[2]).not.toContain("הכי פופולרי");
  });

  it("links to the privacy policy and the terms, and back to the landing page", () => {
    expect(html).toContain('href="/privacy"');
    expect(html).toContain('href="/terms"');
    expect(html).toContain('href="/"');
  });

  it("the comparison is a real table with a header cell per plan and a header cell per row", () => {
    expect(count(/<table[\s>]/g)).toBe(1);
    expect(html).toContain("<caption");
    const head = /<thead>([\s\S]*?)<\/thead>/.exec(html)![1];
    const columnHeaders = head.match(/<th scope="col"/g) ?? [];
    expect(columnHeaders).toHaveLength(1 + PLANS.length); // the feature column and one per plan
    for (const plan of PLANS) expect(head).toContain(plan.name);
    expect(count(/<th scope="row"/g)).toBe(FEATURES.length);
  });

  it("the table scrolls inside its own box, not the page", () => {
    const box = /<div[^>]*role="region"[^>]*><table/.exec(html)?.[0] ?? "";
    expect(box).toContain("overflow-x-auto");
    // "relative" keeps the screen-reader texts (absolutely positioned) inside the box: without it they
    // escape it and make the whole page scroll sideways on a phone
    expect(box).toMatch(/class="[^"]*\brelative\b/);
  });

  it("a yes and a no are said in words for screen readers", () => {
    expect(html).toContain("כלול");
    expect(html).toContain("לא כלול");
  });

  it("the FAQ is native details/summary, so it works without JavaScript", () => {
    expect(count(/<details[\s>]/g)).toBe(FAQ.length);
    expect(count(/<summary[\s>]/g)).toBe(FAQ.length);
  });

  it("no forms, no card fields, no scripts, no external requests", () => {
    expect(html).not.toMatch(/<(form|input|button|script|iframe|img|link)[\s>]/);
    expect(html).not.toMatch(/(src|href)="https?:/);
  });

  it("every link is a comfortable tap target (at least 44px high)", () => {
    const anchors = html.match(/<a [^>]*>/g) ?? [];
    expect(anchors.length).toBe(8); // logo, back, header CTA, three plan CTAs, privacy, terms
    for (const a of anchors) expect(a, a).toMatch(/(?:^|[ "])(?:min-)?h-(?:11|\[52px\])[ "]/);
  });

  it("is not about anything that is not built", () => {
    for (const word of ["וואטסאפ", "קמפיין", "קופה", "מלאי"]) expect(html).not.toContain(word);
  });
});

describe("the page metadata", () => {
  it("title, description, canonical and Open Graph", () => {
    expect(metadata.title).toBe("מחירון | TorNow");
    expect(String(metadata.description).length).toBeGreaterThan(20);
    expect(metadata.alternates?.canonical).toBe("/pricing");
    expect(metadata.openGraph).toMatchObject({ title: "מחירון | TorNow", url: "/pricing", locale: "he_IL" });
  });
});

describe("the sitemap", () => {
  it("includes /pricing next to the landing page and the legal pages", () => {
    const urls = sitemap().map((e) => e.url);
    expect(urls.some((u) => u.endsWith("/pricing"))).toBe(true);
    expect(urls.some((u) => u.endsWith("/privacy"))).toBe(true);
    expect(urls.some((u) => u.endsWith("/terms"))).toBe(true);
  });
});

describe("the landing page", () => {
  const landing = readFileSync("app/page.tsx", "utf8");

  it("links to the pricing page from the header navigation and from the footer", () => {
    expect(landing).toContain('href="/pricing"');
    expect(landing).toContain('{ href: "/pricing", label: "מחירון" }');
  });

  it("keeps its in-page anchors", () => {
    for (const id of ["how", "who", "owner", "features", "faq"]) expect(landing).toContain(`{ id: "${id}"`);
    expect(landing).toContain("href={`#${n.id}`}");
  });

  it("uses the shared legal bar, which links to /privacy and /terms", () => {
    expect(landing).toContain("<LegalBar />");
    const bar = readFileSync("components/landing/LegalBar.tsx", "utf8");
    expect(bar).toContain('href="/privacy"');
    expect(bar).toContain('href="/terms"');
  });
});
