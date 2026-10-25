import type { Metadata } from "next";
import React from "react";
import Link from "next/link";
import { Check, ChevronLeft } from "lucide-react";
import { Logo } from "@/components/brand/Logo";
import { LegalBar } from "@/components/landing/LegalBar";
import { cn } from "@/lib/utils";
import {
  FAQ,
  FEATURES,
  LAUNCH_BANNER,
  PLANS,
  PRICING_COPY,
  SIGNUP_HREF,
  VAT_NOTE,
  formatPrice,
  planCardFeatures,
  type FeatureValue,
  type Plan,
} from "@/lib/pricing";

// Rendered per request like the other pages: the root layout sets the Content-Security-Policy nonce.
// There is no client JavaScript on this page (a server component: no hooks, no handlers, no external requests).
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: PRICING_COPY.title,
  description: PRICING_COPY.description,
  alternates: { canonical: "/pricing" },
  openGraph: {
    title: PRICING_COPY.title,
    description: PRICING_COPY.description,
    type: "website",
    locale: "he_IL",
    siteName: "TorNow",
    url: "/pricing",
  },
  twitter: { card: "summary", title: PRICING_COPY.title },
};

const frame = "mx-auto max-w-[1200px] border-ink-200 xl:border-x";
const pad = "px-5 sm:px-8 lg:px-14";
const keyPrimary =
  "m-key inline-flex h-[52px] w-full items-center justify-center gap-2 rounded-lg bg-brand-600 px-6 text-[16px] font-bold text-white";
const keySecondary =
  "m-key2 inline-flex h-[52px] w-full items-center justify-center gap-2 rounded-lg border border-ink-200 bg-white px-6 text-[16px] font-bold text-ink-900";

export default function PricingPage() {
  return (
    <div className="l-page min-h-screen bg-paper text-ink-900">
      <header className="sticky top-0 z-40 border-b border-ink-200 bg-paper/90 backdrop-blur-md">
        <div className={cn(frame, "flex h-16 items-center gap-3 px-5 sm:gap-8 sm:px-8 lg:px-10")}>
          <Link href="/" aria-label="TorNow, לעמוד הבית" className="inline-flex min-h-11 flex-none items-center">
            <Logo />
          </Link>
          <div className="ms-auto flex items-center gap-1 sm:gap-2">
            <Link
              href="/"
              className="inline-flex h-11 items-center whitespace-nowrap rounded-md px-2 text-[14px] font-bold text-ink-800 transition-colors hover:bg-ink-100 sm:px-3 sm:text-[15px]"
            >
              {PRICING_COPY.backToHome}
            </Link>
            <Link
              href={SIGNUP_HREF}
              className="m-key inline-flex h-11 items-center gap-1.5 whitespace-nowrap rounded-lg bg-brand-600 px-3 text-[14px] font-bold text-white sm:px-4 sm:text-[15px]"
            >
              {PRICING_COPY.headerCta}
              <ChevronLeft className="hidden h-4 w-4 text-lime sm:block" aria-hidden="true" />
            </Link>
          </div>
        </div>
      </header>

      <main>
        <div className="border-b border-ink-200 bg-lime-soft">
          <p role="note" className={cn(frame, "px-5 py-3 text-[15px] font-semibold leading-relaxed text-ink-900 sm:px-8 lg:px-14")}>
            {LAUNCH_BANNER}
          </p>
        </div>

        <section aria-labelledby="pricing-heading">
          <div className={cn(frame, pad, "pb-10 pt-12 sm:pt-16")}>
            <h1
              id="pricing-heading"
              className="text-[36px] font-extrabold leading-[1.05] tracking-[-0.02em] text-balance sm:text-[52px]"
            >
              {PRICING_COPY.heading}
            </h1>
            <p className="mt-5 max-w-[48ch] text-[17px] leading-relaxed text-ink-700 sm:text-lg">{PRICING_COPY.intro}</p>

            <ul className="mt-10 grid gap-5 lg:grid-cols-3 lg:items-stretch">
              {PLANS.map((plan) => (
                <li key={plan.id} className="flex">
                  <PlanCard plan={plan} />
                </li>
              ))}
            </ul>
            <p className="mt-5 text-[14px] text-ink-700">{VAT_NOTE}</p>
          </div>
        </section>

        <section aria-labelledby="compare-heading" className="border-t border-ink-200 bg-white">
          <div className={cn(frame, pad, "py-14 sm:py-20")}>
            <h2 id="compare-heading" className="text-[28px] font-extrabold leading-tight sm:text-[36px]">
              {PRICING_COPY.comparisonTitle}
            </h2>
            <p className="mt-3 text-[14px] text-ink-700 sm:hidden">אפשר לגלול את הטבלה הצידה.</p>
            {/* the table scrolls inside this box, never the whole page ("relative": the screen-reader texts in the cells are
                absolutely positioned and would otherwise escape the box and widen the page) */}
            <div
              role="region"
              aria-labelledby="compare-heading"
              tabIndex={0}
              className="relative mt-4 overflow-x-auto rounded-lg border border-ink-200 focus-visible:outline-2 focus-visible:outline-offset-2"
            >
              <table className="w-full min-w-[480px] border-collapse text-right text-[14px] sm:min-w-[620px] sm:text-[15px]">
                <caption className="sr-only">{PRICING_COPY.comparisonTitle}</caption>
                <thead>
                  <tr className="border-b border-ink-200 bg-ink-50">
                    <th scope="col" className="w-[40%] px-3 py-4 text-[14px] font-bold text-ink-700 sm:px-4">
                      תכונה
                    </th>
                    {PLANS.map((plan) => (
                      <th
                        key={plan.id}
                        scope="col"
                        className={cn("px-2 py-4 text-center align-bottom sm:px-4", plan.highlighted && "bg-lime-soft")}
                      >
                        <span className="block text-[16px] font-extrabold text-ink-900">{plan.name}</span>
                        {plan.price > 0 && <span className="block text-[14px] font-semibold text-ink-700">{formatPrice(plan.price)}</span>}
                        {plan.highlighted && (
                          <span className="mt-1 block text-[12px] font-bold text-ink-900">{PRICING_COPY.planLabelHighlight}</span>
                        )}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {FEATURES.map((feature) => (
                    <tr key={feature.label} className="border-b border-ink-100 last:border-b-0">
                      <th scope="row" className="px-3 py-3.5 text-[14px] font-semibold leading-snug text-ink-900 sm:px-4 sm:text-[15px]">
                        {feature.label}
                      </th>
                      {PLANS.map((plan) => (
                        <td key={plan.id} className={cn("px-2 py-3.5 text-center leading-snug sm:px-4", plan.highlighted && "bg-lime-soft/50")}>
                          <Cell value={feature.values[plan.id]} />
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </section>

        <section aria-labelledby="faq-heading" className="border-t border-ink-200">
          <div className={cn(frame, pad, "py-14 sm:py-20")}>
            <h2 id="faq-heading" className="text-[28px] font-extrabold leading-tight sm:text-[36px]">
              {PRICING_COPY.faqTitle}
            </h2>
            <div className="mt-8 max-w-[760px] border-t border-ink-200">
              {FAQ.map((item) => (
                <details key={item.question} className="l-faq border-b border-ink-200">
                  <summary className="flex min-h-11 cursor-pointer items-center justify-between gap-6 py-5 text-[17px] font-bold transition-colors hover:text-brand-600 lg:text-[19px]">
                    {item.question}
                    <span aria-hidden="true" className="l-faq-icon relative h-4 w-4 flex-none">
                      <span className="absolute inset-x-0 top-1/2 h-[2px] -translate-y-1/2 bg-current" />
                      <span className="absolute inset-y-0 left-1/2 w-[2px] -translate-x-1/2 bg-current" />
                    </span>
                  </summary>
                  <p className="l-faq-body max-w-[60ch] pb-6 text-[16px] leading-relaxed text-ink-700">{item.answer}</p>
                </details>
              ))}
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t border-ink-200 bg-white">
        <div className={cn(frame, pad, "pb-10 pt-8")}>
          <LegalBar />
        </div>
      </footer>
    </div>
  );
}

function PlanCard({ plan }: { plan: Plan }) {
  const { inheritsFrom, lines } = planCardFeatures(plan.id);
  const free = plan.price === 0;
  const headingId = `plan-${plan.id}`;
  return (
    <article
      aria-labelledby={headingId}
      className={cn(
        "flex w-full flex-col rounded-xl border bg-white p-6 sm:p-7",
        plan.highlighted ? "border-2 border-brand-600 shadow-lg" : "border-ink-200"
      )}
    >
      <div className="flex min-h-7 items-center">
        {plan.highlighted && (
          <span className="inline-flex items-center rounded-md bg-lime px-2.5 py-1 text-[13px] font-bold text-lime-ink">
            {PRICING_COPY.planLabelHighlight}
          </span>
        )}
      </div>
      <h2 id={headingId} className="mt-2 text-[26px] font-extrabold leading-tight">
        {plan.name}
      </h2>
      <p className="mt-1 text-[15px] leading-relaxed text-ink-700">{plan.audience}</p>

      <p className="mt-5 flex items-baseline gap-2">
        <span className="text-[44px] font-extrabold leading-none tracking-[-0.02em]">{formatPrice(plan.price)}</span>
        {!free && <span className="text-[15px] font-semibold text-ink-700">/ {PRICING_COPY.perMonth}</span>}
      </p>

      <Link href={SIGNUP_HREF} className={cn("mt-6", plan.highlighted ? keyPrimary : keySecondary)}>
        {free ? PRICING_COPY.ctaFree : PRICING_COPY.ctaPaid}
      </Link>

      <div className="mt-6 border-t border-ink-200 pt-5">
        {inheritsFrom && (
          <p className="mb-3 text-[15px] font-bold text-ink-900">{PRICING_COPY.inherits(inheritsFrom.name)}</p>
        )}
        <ul className="space-y-3">
          {lines.map((text) => (
            <li key={text} className="flex items-start gap-3 text-[15px] leading-snug text-ink-900">
              <Check className="mt-0.5 h-5 w-5 flex-none text-brand-600" aria-hidden="true" />
              <span>{text}</span>
            </li>
          ))}
        </ul>
      </div>
    </article>
  );
}

/** One cell of the table: a check (with a text for screen readers), a dash, or a short text. */
function Cell({ value }: { value: FeatureValue }) {
  if (typeof value === "string") return <span className="font-semibold text-ink-900">{value}</span>;
  if (value) {
    return (
      <>
        <Check className="mx-auto h-5 w-5 text-brand-600" aria-hidden="true" />
        <span className="sr-only">כלול</span>
      </>
    );
  }
  return (
    <>
      <span aria-hidden="true" className="text-ink-600">
        —
      </span>
      <span className="sr-only">לא כלול</span>
    </>
  );
}
