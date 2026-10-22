import React from "react";
import Link from "next/link";
import { Logo } from "@/components/brand/Logo";
import { LEGAL_LAST_UPDATED } from "@/lib/legal";

export interface LegalSection {
  id: string;
  title: string;
  body: React.ReactNode;
}

/** Plain, server-rendered page for the legal texts: readable without JavaScript. */
export function LegalDocument({
  title,
  intro,
  sections,
  current,
}: {
  title: string;
  intro?: React.ReactNode;
  sections: LegalSection[];
  current: "privacy" | "terms";
}) {
  return (
    <>
      <header className="border-b border-ink-200 bg-white">
        <div className="mx-auto flex max-w-[860px] items-center justify-between px-5 py-4 sm:px-8">
          <Link href="/" aria-label="TorNow, לדף הבית">
            <Logo sub="יומן תורים אונליין" />
          </Link>
          <nav aria-label="מסמכים משפטיים" className="flex items-center gap-1 text-[14px] font-semibold">
            <Link
              href="/privacy"
              aria-current={current === "privacy" ? "page" : undefined}
              className="inline-flex min-h-11 items-center px-2 text-ink-700 hover:text-brand-600 aria-[current=page]:text-brand-600"
            >
              מדיניות פרטיות
            </Link>
            <Link
              href="/terms"
              aria-current={current === "terms" ? "page" : undefined}
              className="inline-flex min-h-11 items-center px-2 text-ink-700 hover:text-brand-600 aria-[current=page]:text-brand-600"
            >
              תנאי שימוש
            </Link>
          </nav>
        </div>
      </header>

      <main className="flex-1">
        <article className="mx-auto max-w-[860px] px-5 py-10 sm:px-8 sm:py-14">
          <h1 className="text-[34px] font-extrabold leading-tight tracking-[-0.015em] text-ink-900 sm:text-[44px]">
            {title}
          </h1>
          <p className="mt-3 text-[14px] font-semibold text-ink-500">עודכן לאחרונה: {LEGAL_LAST_UPDATED}</p>
          {intro && <div className="mt-6 space-y-4 text-[16px] leading-relaxed text-ink-700">{intro}</div>}

          <nav aria-label="תוכן עניינים" className="mt-8 rounded-lg border border-ink-200 bg-white p-5">
            <p className="text-[13px] font-bold tracking-wide text-ink-500">תוכן עניינים</p>
            <ol className="mt-2 list-decimal space-y-0.5 pr-5 text-[15px] marker:font-bold marker:text-ink-500">
              {sections.map((s) => (
                <li key={s.id}>
                  <a href={`#${s.id}`} className="inline-flex min-h-9 items-center font-semibold text-ink-800 hover:text-brand-600">
                    {s.title}
                  </a>
                </li>
              ))}
            </ol>
          </nav>

          <div className="mt-10 space-y-10">
            {sections.map((s, i) => (
              <section key={s.id} id={s.id} aria-labelledby={`${s.id}-h`} className="scroll-mt-6">
                <h2 id={`${s.id}-h`} className="text-[22px] font-extrabold leading-snug text-ink-900 sm:text-[26px]">
                  {i + 1}. {s.title}
                </h2>
                <div className="mt-3 space-y-4 text-[16px] leading-relaxed text-ink-700">{s.body}</div>
              </section>
            ))}
          </div>
        </article>
      </main>

      <footer className="border-t border-ink-200 bg-white">
        <div className="mx-auto flex max-w-[860px] flex-col justify-between gap-2 px-5 py-6 text-[14px] text-ink-600 sm:flex-row sm:px-8">
          <span>© TorNow</span>
          <span className="flex gap-4 font-semibold">
            <Link href="/privacy" className="hover:text-brand-600">
              מדיניות פרטיות
            </Link>
            <Link href="/terms" className="hover:text-brand-600">
              תנאי שימוש
            </Link>
            <Link href="/" className="hover:text-brand-600">
              דף הבית
            </Link>
          </span>
        </div>
      </footer>
    </>
  );
}

export function UL({ children }: { children: React.ReactNode }) {
  return <ul className="list-disc space-y-1.5 pr-5 marker:text-ink-400">{children}</ul>;
}

export function H3({ children }: { children: React.ReactNode }) {
  return <h3 className="pt-1 text-[17px] font-bold text-ink-900">{children}</h3>;
}

export function A({ href, children }: { href: string; children: React.ReactNode }) {
  const external = /^https?:/.test(href);
  return (
    <a
      href={href}
      className="font-semibold text-brand-600 underline underline-offset-2 hover:text-brand-800"
      {...(external ? { target: "_blank", rel: "noopener noreferrer" } : {})}
    >
      {children}
    </a>
  );
}

/** Wide tables scroll sideways inside their own box instead of widening the page. */
export function DataTable({ head, rows }: { head: string[]; rows: React.ReactNode[][] }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-ink-200 bg-white">
      <table className="w-full min-w-[520px] border-collapse text-right text-[15px]">
        <thead className="bg-ink-50 text-[13px] font-bold text-ink-600">
          <tr>
            {head.map((h) => (
              <th key={h} scope="col" className="px-4 py-2.5">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-ink-200 align-top">
          {rows.map((r, i) => (
            <tr key={i}>
              {r.map((c, j) => (
                <td key={j} className={j === 0 ? "px-4 py-2.5 font-semibold text-ink-900" : "px-4 py-2.5"}>
                  {c}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
