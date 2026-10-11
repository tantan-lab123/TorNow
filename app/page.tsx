import type { Metadata } from "next";
import React from "react";
import Link from "next/link";
import { Check, ChevronLeft } from "lucide-react";
import { getBusinessBySlug } from "@/lib/db";
import { cn } from "@/lib/utils";
import { Logo } from "@/components/brand/Logo";
import { PhoneFrame, Screen } from "@/components/landing/PhoneFrame";
import { HeroDemo } from "@/components/landing/HeroDemo";
import { ChaosToOrder } from "@/components/landing/ChaosToOrder";
import { BusinessSwitcher } from "@/components/landing/BusinessSwitcher";
import { OwnerTour } from "@/components/landing/OwnerTour";
import { FeatureGrid } from "@/components/landing/FeatureGrid";
import { DemoQr } from "@/components/landing/DemoQr";
import { RevealObserver } from "@/components/landing/RevealObserver";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Torli | יומן תורים אונליין לעסקים",
  description:
    "הלקוחות קובעים, משנים ומבטלים תורים לבד מקישור אחד, ואתם מקבלים התראה ורואים הכל ביומן בטלפון. בלי אפליקציה ללקוח.",
};

// Demo booking pages the landing page links to, in order of preference. Only the ones
// that exist in this database are linked, by name only.
const DEMO_SLUGS = ["barber-dan", "maya-nails", "clinic-rafael"];

async function getDemos(): Promise<{ slug: string; name: string }[]> {
  try {
    const found = await Promise.all(DEMO_SLUGS.map((slug) => getBusinessBySlug(slug)));
    return found.flatMap((b) => (b ? [{ slug: b.slug, name: b.name }] : []));
  } catch {
    return [];
  }
}

const frame = "mx-auto max-w-[1200px] border-ink-200 xl:border-x";
const pad = "px-5 sm:px-8 lg:px-14";
const h2 = "text-[34px] font-extrabold leading-[1.06] tracking-[-0.015em] text-balance sm:text-[44px] lg:text-[52px]";
const lead = "text-[17px] leading-relaxed text-ink-700 sm:text-lg";
const keyPrimary =
  "m-key inline-flex h-[52px] items-center justify-center gap-2 rounded-lg bg-brand-600 px-6 text-[16px] font-bold text-white";
const keySecondary =
  "m-key2 inline-flex h-[52px] items-center justify-center gap-2 rounded-lg border border-ink-200 bg-white px-6 text-[16px] font-bold text-ink-900";

const NAV = [
  { id: "how", label: "איך זה עובד" },
  { id: "who", label: "למי זה מתאים" },
  { id: "owner", label: "הצד שלכם" },
  { id: "features", label: "יכולות" },
  { id: "faq", label: "שאלות נפוצות" },
];

const FACTS = [
  { value: "4", text: "שלבים מהקישור ועד תור קבוע" },
  { value: "0", text: "אפליקציות שהלקוח צריך להוריד" },
  { value: "24/7", text: "הלקוחות קובעים גם כשהעסק סגור" },
  { value: "1", text: "קישור אחד לביו, לוואטסאפ ולדלפק" },
];

const STEPS = [
  {
    n: "01",
    title: "שולחים קישור",
    text: "לכל עסק קישור קבוע משלו. שמים אותו בביו באינסטגרם, בהודעה בוואטסאפ ובקוד QR על הדלפק.",
    screen: "booking-service",
    alt: "עמוד ההזמנה של העסק, כפי שהלקוח רואה אותו כשהוא פותח את הקישור",
  },
  {
    n: "02",
    title: "הלקוח קובע לבד",
    text: "בוחר שירות, יום ושעה מתוך מה שבאמת פנוי, לפי משך הטיפול. בלי הרשמה ובלי סיסמה.",
    screen: "booking-time",
    alt: "בחירת שעה פנויה, מחולקת לבוקר, צהריים וערב",
  },
  {
    n: "03",
    title: "התור כבר ביומן",
    text: "אתם מקבלים התראה, והתור מופיע ביומן עם וואטסאפ וחיוג ללקוח. צריך לשנות? הלקוח עושה את זה לבד.",
    screen: "owner-calendar",
    alt: "היומן של בעל העסק עם התור הבא ותורי היום",
  },
];

const KINDS = [
  "מספרות",
  "ציפורניים",
  "קוסמטיקה",
  "קליניקות",
  "פיזיותרפיה",
  "עיסוי",
  "אימון אישי",
  "פילאטיס ויוגה",
  "שיעורים פרטיים",
  "מורי נהיגה",
  "קעקועים",
  "הסרת שיער",
  "טיפול רגשי",
  "כלבנות",
];

const FAQ = [
  {
    q: "הלקוחות צריכים להוריד אפליקציה?",
    a: "לא. הקישור נפתח בדפדפן של הטלפון, והתור נקבע בכמה לחיצות, בלי הרשמה ובלי סיסמה. מי שרוצה נכנס עם Google, והפרטים שלו נשמרים לפעם הבאה.",
  },
  {
    q: "איך הלקוחות מגיעים לעמוד ההזמנה?",
    a: "לכל עסק יש קישור קבוע משלו. שמים אותו בביו באינסטגרם, בהודעות בוואטסאפ ובפרופיל בגוגל, ומדפיסים קוד QR לדלפק.",
  },
  {
    q: "מה קורה כשלקוח צריך לבטל או להזיז?",
    a: "באישור התור יש קישור לשינוי או ביטול. אתם קובעים עד כמה זמן לפני התור זה מותר, ואחרי זה הלקוח פונה אליכם. על כל שינוי מקבלים התראה.",
  },
  {
    q: "אפשר לעבוד עם כמה עובדים?",
    a: "כן. מוסיפים עובדים ומנהלים לצוות, כל אחד נכנס עם הטלפון והסיסמה שלו ומקבל הרשאות לפי התפקיד.",
  },
  {
    q: "מה אם היום כבר מלא?",
    a: "הלקוח יכול להירשם לרשימת המתנה לאותו יום. אתם רואים את הרשימה, ופונים למי שמחכה בוואטסאפ בלחיצה.",
  },
  {
    q: "אפשר לחסום זמן להפסקה או לחופשה?",
    a: "כן. חוסמים שעה, יום שלם או שבוע, והזמן הזה פשוט לא מוצג ללקוחות. גם חגים אפשר לסגור מראש.",
  },
  {
    q: "המידע של הלקוחות שמור?",
    a: "כל עסק רואה רק את הלקוחות שלו, הכניסה לחשבון מוגנת בסיסמה, ואפשר להוריד גיבוי מלא של העסק בכל רגע.",
  },
];

function SectionLabel({ n, children, dark }: { n?: string; children: React.ReactNode; dark?: boolean }) {
  return (
    <p className={cn("flex items-center gap-3 text-[13px] font-bold tracking-wide", dark ? "text-paper/75" : "text-ink-600")}>
      <span aria-hidden="true" className="h-2.5 w-2.5 flex-none border border-lime-edge bg-lime" />
      {n && <span className="tabular-nums">{n}</span>}
      {n && (
        <span aria-hidden="true" className={dark ? "text-paper/30" : "text-ink-300"}>
          /
        </span>
      )}
      <span>{children}</span>
      <span aria-hidden="true" data-reveal="line" className={cn("h-px flex-1", dark ? "bg-brand-500/70" : "bg-ink-200")} />
    </p>
  );
}

/** The hero's backdrop: a ruled diary page with hours, and a lime "now" line at the phones' 10:40. */
function DiaryPage() {
  const hours = ["09:00", "10:00", "11:00", "12:00", "13:00", "14:00", "15:00", "16:00", "17:00"];
  const now = 56 + (100 / 30) * 56; // 10:40, with a 56px rule every half hour from 09:00
  return (
    <div aria-hidden="true" className="l-fade-y pointer-events-none absolute inset-0">
      <div className="l-ruled absolute inset-0" />
      {hours.map((h, i) => (
        <span
          key={h}
          className="absolute right-3 -translate-y-1/2 text-[11px] font-semibold tabular-nums text-ink-400 sm:right-4"
          style={{ top: 56 + i * 112 }}
        >
          {h}
        </span>
      ))}
      <span className="absolute inset-x-0 h-px bg-lime-edge" style={{ top: now }} />
      <span
        className="absolute right-2 -translate-y-1/2 bg-lime px-1.5 py-0.5 text-[11px] font-bold tabular-nums text-lime-ink sm:right-3"
        style={{ top: now }}
      >
        10:40
      </span>
    </div>
  );
}

const delay = (ms: number) => ({ "--d": `${ms}ms` }) as React.CSSProperties;
const revealDelay = (ms: number) => ({ "--rv-delay": `${ms}ms` }) as React.CSSProperties;

export default async function HomePage() {
  const demos = await getDemos();
  const demo = demos[0];

  return (
    <div className="l-page min-h-screen bg-paper text-ink-900">
      {/* Header */}
      <header className="sticky top-0 z-40 border-b border-ink-200 bg-paper/90 backdrop-blur-md">
        <div className={cn(frame, "flex h-16 items-center gap-8 px-5 sm:px-8 lg:px-10")}>
          <Link href="/" aria-label="Torli, לעמוד הבית" className="flex-none">
            <Logo />
          </Link>
          <nav aria-label="בעמוד הזה" className="hidden items-center gap-1 lg:flex">
            {NAV.map((n) => (
              <a
                key={n.id}
                href={`#${n.id}`}
                className="rounded-md px-3 py-2 text-[15px] font-semibold text-ink-700 transition-colors hover:bg-ink-100 hover:text-ink-900"
              >
                {n.label}
              </a>
            ))}
          </nav>
          <div className="ms-auto flex items-center gap-1 sm:gap-2">
            <Link
              href="/admin"
              className="inline-flex h-11 items-center rounded-md px-3 text-[15px] font-bold text-ink-800 transition-colors hover:bg-ink-100"
            >
              כניסה
            </Link>
            <Link
              href="/admin?new=1"
              className="m-key inline-flex h-11 items-center gap-1.5 rounded-lg bg-brand-600 px-4 text-[15px] font-bold text-white"
            >
              פתיחת יומן
              <ChevronLeft className="h-4 w-4 text-lime" />
            </Link>
          </div>
        </div>
      </header>

      {/* Hero: the promise, and the product doing it */}
      <section>
        <div className={cn(frame, "grid xl:grid-cols-[minmax(0,1.04fr)_minmax(0,1fr)]")}>
          <div className={cn(pad, "pb-14 pt-12 sm:pt-16 xl:py-24 xl:pl-12")}>
            <p className="l-in flex items-center gap-2.5 text-[13px] font-bold tracking-wide text-ink-700" style={delay(0)}>
              <span aria-hidden="true" className="h-2.5 w-2.5 border border-lime-edge bg-lime" />
              יומן תורים אונליין לעסקים
            </p>
            <h1
              className="l-in mt-6 text-[44px] font-extrabold leading-[1.02] tracking-[-0.025em] text-ink-900 text-balance sm:text-[60px] xl:text-[64px]"
              style={delay(80)}
            >
              הלקוחות קובעים תור <span className="l-mark">לבד.</span>
              <br />
              <span className="text-brand-600">אתם חוזרים לעבוד.</span>
            </h1>
            <p className={cn(lead, "l-in mt-7 max-w-[36ch] sm:text-[20px] sm:leading-[1.6]")} style={delay(160)}>
              קישור אחד לעסק שלכם. הלקוחות בוחרים שירות, יום ושעה פנויה, ואתם מקבלים התראה והתור כבר ביומן. בלי שיחות,
              בלי התכתבויות ובלי אפליקציה ללקוח.
            </p>
            <div className="l-in mt-9 flex flex-col gap-3 min-[390px]:flex-row min-[390px]:flex-wrap" style={delay(240)}>
              <Link href="/admin?new=1" className={keyPrimary}>
                פתיחת יומן לעסק
                <ChevronLeft className="h-5 w-5 text-lime" />
              </Link>
              {demo && (
                <Link href={`/${demo.slug}`} className={keySecondary}>
                  לנסות כמו לקוח
                </Link>
              )}
            </div>
            <ul
              className="l-in mt-10 grid gap-2.5 text-[15px] text-ink-700 sm:flex sm:flex-wrap sm:gap-x-6"
              style={delay(320)}
            >
              {["בלי אפליקציה ללקוח", "מוכן לשימוש תוך דקות", "התראה על כל תור חדש"].map((t) => (
                <li key={t} className="flex items-center gap-2">
                  <Check className="h-4 w-4 text-brand-600" strokeWidth={2.75} aria-hidden="true" />
                  {t}
                </li>
              ))}
            </ul>
          </div>

          <div className="relative overflow-hidden border-t border-ink-200 xl:border-r xl:border-t-0">
            <DiaryPage />
            <div className="relative pb-10 pl-3 pr-12 pt-10 sm:pl-6 sm:pr-16 xl:pb-12 xl:pl-4 xl:pt-14">
              <HeroDemo />
            </div>
          </div>
        </div>
      </section>

      {/* Facts */}
      <section aria-label="Torli בקצרה" className="border-y border-ink-200 bg-white">
        <ul className={cn(frame, "grid grid-cols-2 lg:grid-cols-4")}>
          {FACTS.map((f, i) => (
            <li
              key={f.value}
              data-reveal=""
              style={revealDelay(i * 70)}
              className={cn(
                "border-ink-200 px-5 py-8 sm:px-8 lg:px-10 lg:py-11",
                i % 2 === 0 && "border-l",
                i < 2 && "border-b lg:border-b-0",
                i === 1 && "lg:border-l"
              )}
            >
              <span className="block text-[44px] font-extrabold leading-none tracking-tight tabular-nums lg:text-[60px]">
                {f.value}
              </span>
              <span className="mt-3 block max-w-[22ch] text-[15px] leading-snug text-ink-700">{f.text}</span>
            </li>
          ))}
        </ul>
      </section>

      {/* 01 How it works */}
      <section id="how" className="scroll-mt-16">
        <div className={cn(frame, pad, "pt-20 lg:pt-28")}>
          <SectionLabel n="01">איך זה עובד</SectionLabel>
          <div className="mt-6 grid gap-6 lg:grid-cols-2 lg:items-end lg:gap-16">
            <h2 className={h2}>שלושה צעדים, ותור ביומן.</h2>
            <p className={cn(lead, "max-w-[44ch]")}>
              מגדירים פעם אחת שירותים, משך ושעות פעילות. מכאן הלקוחות קובעים, משנים ומבטלים לבד, ואתם רואים רק את התוצאה.
            </p>
          </div>
        </div>
        <div className={cn(frame, "mt-14 grid border-t lg:mt-20 lg:grid-cols-3")}>
          {STEPS.map((s, i) => (
            <article
              key={s.n}
              className={cn(
                "group flex flex-col border-ink-200 px-5 pt-10 sm:px-8 lg:px-10",
                i > 0 && "border-t lg:border-t-0",
                i < STEPS.length - 1 && "lg:border-l"
              )}
            >
              <div className="flex items-center gap-4">
                <span className="grid h-11 w-11 flex-none place-items-center bg-brand-600 text-[15px] font-extrabold tabular-nums text-lime">
                  {s.n}
                </span>
                <span aria-hidden="true" data-reveal="line" className="h-px flex-1 bg-ink-300" style={revealDelay(i * 160)} />
              </div>
              <h3 className="mt-6 text-[26px] font-extrabold tracking-tight">{s.title}</h3>
              <p className="mt-3 max-w-[36ch] text-[16px] leading-relaxed text-ink-700">{s.text}</p>
              {/* Phones rise from the same baseline, however long the text above them is */}
              <div className="mt-auto pt-8">
                <div className="relative h-[300px] overflow-hidden sm:h-[380px]">
                  <div data-reveal="rise" className="absolute inset-x-0 top-3 flex justify-center" style={revealDelay(i * 140)}>
                    <PhoneFrame className="w-[236px] transition-transform duration-500 ease-out group-hover:-translate-y-3 sm:w-[250px]">
                      <Screen name={s.screen} alt={s.alt} />
                    </PhoneFrame>
                  </div>
                </div>
              </div>
            </article>
          ))}
        </div>
      </section>

      {/* The pain, and what Torli does about it */}
      <section className="overflow-hidden border-t border-brand-800 bg-brand-700 text-paper">
        <div
          className={cn(
            frame,
            pad,
            "l-frame grid items-center gap-12 border-brand-600 py-20 [--l-cross:#5E8F6C] lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)] lg:gap-20 lg:py-28"
          )}
        >
          <div>
            <SectionLabel dark>נשמע מוכר?</SectionLabel>
            <h2 className={cn(h2, "mt-6")}>הולכים לאיבוד בין ההודעות של הלקוחות?</h2>
            <p className="mt-6 max-w-[42ch] text-[17px] leading-relaxed text-paper/80 sm:text-lg">
              {/* Each quote stays on one line, so a closing ״ never starts a line */}
              <span className="whitespace-nowrap">״יש לך משהו מחר?״,</span>{" "}
              <span className="whitespace-nowrap">״אפשר להזיז לחמישי?״,</span>{" "}
              <span className="whitespace-nowrap">״כמה זה עולה?״.</span> כל הודעה כזאת עוצרת לכם את העבודה באמצע. עם
              Torli הלקוחות מסדרים את זה לבד, ואתם רואים רק את התוצאה ביומן.
            </p>
          </div>
          <ChaosToOrder />
        </div>
      </section>

      {/* Kinds of businesses */}
      <div className="l-marquee-wrap overflow-hidden border-b border-ink-200 bg-white">
        <p className="sr-only">Torli מתאים ל{KINDS.join(", ")}.</p>
        <div aria-hidden="true" className="l-marquee flex w-max">
          {[0, 1].map((copy) => (
            <ul key={copy} className="flex flex-none items-center">
              {KINDS.map((k) => (
                <li
                  key={k}
                  className="flex items-center gap-8 whitespace-nowrap px-4 py-6 text-[22px] font-extrabold tracking-tight text-ink-800 sm:text-[26px]"
                >
                  {k}
                  <span className="h-2 w-2 border border-lime-edge bg-lime" />
                </li>
              ))}
            </ul>
          ))}
        </div>
      </div>

      {/* 02 For whom */}
      <section id="who" className="scroll-mt-16">
        <div className={cn(frame, pad, "py-20 lg:py-28")}>
          <SectionLabel n="02">למי זה מתאים</SectionLabel>
          <h2 className={cn(h2, "mt-6 max-w-[18ch]")}>כל עסק שעובד עם תורים.</h2>
          <p className={cn(lead, "mt-5 max-w-[52ch]")}>
            מגדירים שירותים, משך, מחיר ושעות פעילות, ועמוד ההזמנה נראה כמו העסק שלכם. בחרו סוג עסק, ונסו לגעת בשירות בטלפון.
          </p>
          <div className="mt-12 lg:mt-16">
            <BusinessSwitcher liveDemos={demos.map((d) => d.slug)} />
          </div>
        </div>
      </section>

      {/* 03 The owner's side */}
      <section id="owner" className="scroll-mt-16 border-t border-ink-200 bg-white">
        <div className={cn(frame, pad, "l-frame py-20 lg:py-28")}>
          <SectionLabel n="03">הצד שלכם</SectionLabel>
          <h2 className={cn(h2, "mt-6 max-w-[18ch]")}>כל העסק בטלפון אחד.</h2>
          <p className={cn(lead, "mt-5 max-w-[52ch]")}>
            יומן, לקוחות ומספרים, מסודרים בלשוניות בתחתית המסך. מוסיפים את Torli למסך הבית ומקבלים התראה על כל תור.
          </p>
          <div className="mt-12 lg:mt-16">
            <OwnerTour />
          </div>
        </div>
      </section>

      {/* 04 Features */}
      <section id="features" className="scroll-mt-16 border-t border-ink-200">
        <div className={cn(frame, pad, "l-frame py-20 lg:py-28")}>
          <SectionLabel n="04">יכולות</SectionLabel>
          <div className="mt-6 grid gap-6 lg:grid-cols-2 lg:items-end lg:gap-16">
            <h2 className={h2}>כל מה שעסק עם תורים צריך.</h2>
            <p className={cn(lead, "max-w-[44ch]")}>
              הכל כבר עובד במערכת, ואתם מפעילים רק את מה שמתאים לעסק. בלי תוספים ובלי הגדרות מסובכות.
            </p>
          </div>
          <div className="mt-12 lg:mt-16">
            <FeatureGrid />
          </div>
        </div>
      </section>

      {/* 05 FAQ */}
      <section id="faq" className="scroll-mt-16 border-t border-ink-200 bg-white">
        <div className={cn(frame, pad, "l-frame grid gap-12 py-20 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.45fr)] lg:gap-20 lg:py-28")}>
          <div>
            <SectionLabel n="05">שאלות נפוצות</SectionLabel>
            <h2 className={cn(h2, "mt-6")}>שאלות לפני שמתחילים.</h2>
            <p className={cn(lead, "mt-5 max-w-[36ch]")}>
              הדרך הכי מהירה לקבל תשובה היא לנסות: קובעים תור לדוגמה, ורואים בדיוק מה הלקוחות שלכם יראו.
            </p>
            {demo && (
              <Link href={`/${demo.slug}`} className={cn(keySecondary, "mt-8")}>
                לנסות כמו לקוח
              </Link>
            )}
          </div>
          <div className="border-t border-ink-200">
            {FAQ.map((item) => (
              <details key={item.q} name="faq" className="l-faq border-b border-ink-200">
                <summary className="flex cursor-pointer items-center justify-between gap-6 py-5 text-[17px] font-bold transition-colors hover:text-brand-600 lg:py-6 lg:text-[19px]">
                  {item.q}
                  <span aria-hidden="true" className="l-faq-icon relative h-4 w-4 flex-none">
                    <span className="absolute inset-x-0 top-1/2 h-[2px] -translate-y-1/2 bg-current" />
                    <span className="absolute inset-y-0 left-1/2 w-[2px] -translate-x-1/2 bg-current" />
                  </span>
                </summary>
                <p className="l-faq-body max-w-[60ch] pb-6 text-[16px] leading-relaxed text-ink-700">{item.a}</p>
              </details>
            ))}
          </div>
        </div>
      </section>

      {/* Final call */}
      <section className="border-t border-ink-200">
        <div className={cn(frame, pad, "l-frame py-20 lg:py-28")}>
          <div
            data-reveal=""
            className="m-ticket grid rounded-[14px] bg-brand-600 text-paper [--notch:#F4F1E8] lg:grid-cols-[minmax(0,1fr)_auto]"
          >
            <div className="p-8 sm:p-12 lg:p-16">
              <h2 className="text-[36px] font-extrabold leading-[1.04] tracking-[-0.02em] text-balance sm:text-[48px] lg:text-[60px]">
                מתחילים לקבל תורים <span className="text-lime">עוד היום.</span>
              </h2>
              <p className="mt-5 max-w-[44ch] text-[17px] leading-relaxed text-paper/80 sm:text-lg">
                פותחים יומן, מגדירים שירותים ושעות פעילות, ושולחים ללקוחות את הקישור. מהרגע הזה הם קובעים לבד.
              </p>
              <div className="mt-9 flex flex-col gap-3 min-[390px]:flex-row min-[390px]:flex-wrap">
                <Link
                  href="/admin?new=1"
                  className="m-key inline-flex h-[52px] items-center justify-center gap-2 rounded-lg bg-lime px-6 text-[16px] font-bold text-lime-ink"
                >
                  פתיחת יומן לעסק
                  <ChevronLeft className="h-5 w-5" />
                </Link>
                {demo && (
                  <Link
                    href={`/${demo.slug}`}
                    className="m-press inline-flex h-[52px] items-center justify-center rounded-lg border border-paper/35 px-6 text-[16px] font-bold text-paper hover:bg-paper/10"
                  >
                    לנסות כמו לקוח
                  </Link>
                )}
              </div>
            </div>
            {demo && (
              <div className="hidden flex-col items-center justify-center gap-4 border-r-2 border-dashed border-paper/25 px-14 lg:flex">
                <DemoQr path={`/${demo.slug}`} />
                <p className="text-center text-[14px] font-bold leading-snug">
                  סורקים ומנסים
                  <br />
                  <span className="font-medium text-paper/75">מהטלפון שלכם</span>
                </p>
              </div>
            )}
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-ink-200 bg-white">
        <div className={cn(frame, pad, "pb-10 pt-14")}>
          <div className="grid gap-10 sm:grid-cols-2 lg:grid-cols-[1.4fr_1fr_1fr_1fr]">
            <div>
              <Logo sub="יומן תורים אונליין" />
              <p className="mt-4 max-w-[32ch] text-[15px] leading-relaxed text-ink-600">
                הלקוחות קובעים, משנים ומבטלים לבד. אתם רואים הכל ביומן אחד בטלפון.
              </p>
            </div>
            <FooterColumn title="המוצר" links={NAV.map((n) => ({ href: `#${n.id}`, label: n.label }))} />
            {demos.length > 0 && (
              <FooterColumn title="לנסות כמו לקוח" links={demos.map((d) => ({ href: `/${d.slug}`, label: d.name }))} />
            )}
            <FooterColumn
              title="בעלי עסקים"
              links={[
                { href: "/admin?new=1", label: "פתיחת יומן לעסק" },
                { href: "/admin", label: "כניסה לחשבון" },
              ]}
            />
          </div>
          <div className="mt-12 flex flex-col justify-between gap-2 border-t border-ink-200 pt-6 text-[14px] text-ink-600 sm:flex-row">
            <span>© Torli</span>
            <span>תורים לעסקים קטנים בישראל</span>
          </div>
        </div>
      </footer>

      <RevealObserver />
    </div>
  );
}

function FooterColumn({ title, links }: { title: string; links: { href: string; label: string }[] }) {
  return (
    <div>
      <p className="text-[13px] font-bold tracking-wide text-ink-500">{title}</p>
      <ul className="mt-4 space-y-2.5">
        {links.map((l) => (
          <li key={l.href}>
            {l.href.startsWith("#") ? (
              <a href={l.href} className="text-[15px] font-semibold text-ink-800 hover:text-brand-600">
                {l.label}
              </a>
            ) : (
              <Link href={l.href} className="text-[15px] font-semibold text-ink-800 hover:text-brand-600">
                {l.label}
              </Link>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
