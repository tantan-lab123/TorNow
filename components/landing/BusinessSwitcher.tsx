"use client";

import React, { useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  Check,
  ChevronLeft,
  Clock,
  Dumbbell,
  Flower2,
  GraduationCap,
  Hand,
  MessageCircle,
  Phone,
  Scissors,
  Stethoscope,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { PhoneFrame } from "./PhoneFrame";

type Service = { name: string; minutes: number; rest: number; price: number };
type Kind = {
  id: string;
  label: string;
  icon: LucideIcon;
  business: string;
  /** Slug of a live demo page for this kind of business, when there is one. */
  demo?: string;
  note: string;
  points: string[];
  services: Service[];
};

// Each point is a setting that exists in Torli today.
const KINDS: Kind[] = [
  {
    id: "barber",
    label: "מספרה",
    icon: Scissors,
    business: "מספרת דניאל - Barber Dan",
    demo: "barber-dan",
    note: "תורים קצרים וצפופים, בלי חורים ביומן.",
    points: ["משך ומחיר לכל שירות", "שעות פעילות שונות לכל יום", "רשימת המתנה כשהיום מלא"],
    services: [
      { name: "עיצוב וסידור זקן", minutes: 20, rest: 5, price: 45 },
      { name: "תספורת גברים קלאסית", minutes: 30, rest: 5, price: 80 },
      { name: "חבילת VIP: תספורת + זקן + חפיפה", minutes: 50, rest: 10, price: 115 },
    ],
  },
  {
    id: "nails",
    label: "ציפורניים",
    icon: Hand,
    business: "סטודיו מיה - ציפורניים ויופי",
    demo: "maya-nails",
    note: "טיפולים ארוכים, עם זמן מנוחה בין לקוחה ללקוחה.",
    points: ["זמן מנוחה אחרי כל טיפול", "לקוחה חוזרת מזוהה לפי הטלפון", "תשלום בביט או בפייבוקס"],
    services: [
      { name: "מניקור משולב לק ג׳ל", minutes: 60, rest: 10, price: 140 },
      { name: "מבנה אנטומי וחיזוק ציפורניים", minutes: 75, rest: 10, price: 180 },
      { name: "פדיקור רפואי / ספא מפנק", minutes: 50, rest: 10, price: 160 },
    ],
  },
  {
    id: "beauty",
    label: "קוסמטיקה",
    icon: Flower2,
    business: "סטודיו נוי - קוסמטיקה מתקדמת",
    note: "מחירון מלא, עם משך ומחיר לכל טיפול.",
    points: ["לוגו ותמונת כיסוי לעמוד", "תזכורת בוואטסאפ בלחיצה", "ביטול עצמי עד מועד שאתם קובעים"],
    services: [
      { name: "טיפול פנים קלאסי", minutes: 60, rest: 10, price: 280 },
      { name: "ניקוי עמוק לעור שמן", minutes: 75, rest: 10, price: 320 },
      { name: "עיצוב גבות בשעווה", minutes: 20, rest: 5, price: 70 },
    ],
  },
  {
    id: "clinic",
    label: "קליניקה",
    icon: Stethoscope,
    business: "קליניקת רפאל - עיסוי ופיזיותרפיה",
    demo: "clinic-rafael",
    note: "טיפולים של 45 ו-50 דקות, וזמן התארגנות ביניהם.",
    points: ["קביעה רק כמה שעות מראש", "ביטול עד מועד שאתם קובעים", "צוות עם הרשאות לפי תפקיד"],
    services: [
      { name: "עיסוי שוודי / רקמות עמוקות", minutes: 50, rest: 10, price: 250 },
      { name: "טיפול פיזיותרפיה ושיקום תנועה", minutes: 45, rest: 15, price: 300 },
      { name: "פגישת הערכה ראשונה", minutes: 30, rest: 10, price: 200 },
    ],
  },
  {
    id: "trainer",
    label: "אימון אישי",
    icon: Dumbbell,
    business: "עומר - אימון אישי ופונקציונלי",
    note: "אימונים אישיים וזוגיים, בשעות שמשתנות מיום ליום.",
    points: ["שעות שונות לכל יום בשבוע", "הגבלת תורים פתוחים ללקוח", "חסימת זמן להפסקה או לחופשה"],
    services: [
      { name: "אימון אישי", minutes: 60, rest: 0, price: 200 },
      { name: "אימון זוגי", minutes: 60, rest: 0, price: 260 },
      { name: "אימון ניסיון", minutes: 45, rest: 0, price: 120 },
    ],
  },
  {
    id: "tutor",
    label: "שיעורים פרטיים",
    icon: GraduationCap,
    business: "מיכל - שיעורים פרטיים במתמטיקה",
    note: "שיעורים קבועים, וביטול רק עד מועד שאתם קובעים.",
    points: ["קביעה עד כמה ימים קדימה", "ביטול עצמי עד מועד שאתם קובעים", "תאריך עברי וחגים בלוח"],
    services: [
      { name: "שיעור פרטי", minutes: 45, rest: 0, price: 150 },
      { name: "שיעור כפול לקראת בגרות", minutes: 90, rest: 0, price: 280 },
      { name: "שיעור ניסיון", minutes: 30, rest: 0, price: 90 },
    ],
  },
];

/**
 * "For whom": pick a kind of business and the phone shows its booking page, built from
 * the same markup as the real one. Services in the phone can be tapped.
 */
export function BusinessSwitcher({ liveDemos }: { liveDemos: string[] }) {
  const [active, setActive] = useState(0);
  const [picked, setPicked] = useState(0);
  const tabs = useRef<(HTMLButtonElement | null)[]>([]);
  const kind = KINDS[active];
  const demo = kind.demo && liveDemos.includes(kind.demo) ? kind.demo : undefined;

  const select = (i: number) => {
    setActive(i);
    setPicked(0);
  };

  // Arrow keys move between tabs (RTL: left is next).
  const onKeyDown = (e: React.KeyboardEvent) => {
    const step = e.key === "ArrowLeft" ? 1 : e.key === "ArrowRight" ? -1 : 0;
    if (!step) return;
    e.preventDefault();
    const next = (active + step + KINDS.length) % KINDS.length;
    select(next);
    tabs.current[next]?.focus();
  };

  return (
    <div className="grid items-start gap-12 lg:grid-cols-[minmax(0,1fr)_auto] lg:gap-20">
      <div>
        <div
          role="tablist"
          aria-label="סוג העסק"
          onKeyDown={onKeyDown}
          className="grid grid-cols-2 gap-px border border-ink-200 bg-ink-200 sm:grid-cols-3"
        >
          {KINDS.map((k, i) => {
            const on = i === active;
            const Icon = k.icon;
            return (
              <button
                key={k.id}
                ref={(el) => {
                  tabs.current[i] = el;
                }}
                type="button"
                role="tab"
                id={`kind-tab-${k.id}`}
                aria-selected={on}
                aria-controls="kind-panel"
                tabIndex={on ? 0 : -1}
                onClick={() => select(i)}
                className={cn(
                  "flex h-14 items-center gap-2.5 px-4 text-right text-[15px] font-bold transition-colors duration-200",
                  on ? "bg-brand-600 text-white" : "bg-paper text-ink-800 hover:bg-white"
                )}
              >
                <Icon className={cn("h-[18px] w-[18px] flex-none", on ? "text-lime" : "text-ink-500")} strokeWidth={2} />
                {k.label}
              </button>
            );
          })}
        </div>

        <div key={kind.id} className="l-fade mt-10">
          <p className="max-w-[24ch] text-[26px] font-extrabold leading-snug tracking-tight sm:text-[30px]">{kind.note}</p>
          <ul className="mt-7 border-t border-ink-200">
            {kind.points.map((p) => (
              <li key={p} className="flex items-center gap-3 border-b border-ink-200 py-3.5 text-[16px] text-ink-800">
                <span className="grid h-5 w-5 flex-none place-items-center border border-lime-edge bg-lime">
                  <Check className="h-3.5 w-3.5 text-lime-ink" strokeWidth={3} />
                </span>
                {p}
              </li>
            ))}
          </ul>
          {demo && (
            <Link
              href={`/${demo}`}
              className="group mt-4 inline-flex min-h-11 items-center gap-1.5 text-[16px] font-bold text-brand-600 hover:text-brand-700"
            >
              לפתוח את עמוד ההזמנה של {kind.business.split(" - ")[0]}
              <ChevronLeft className="h-4 w-4 transition-transform group-hover:-translate-x-1" />
            </Link>
          )}
        </div>
      </div>

      <div
        id="kind-panel"
        role="tabpanel"
        aria-labelledby={`kind-tab-${kind.id}`}
        className="justify-self-center lg:justify-self-end"
      >
        <PhoneFrame className="w-[min(290px,78vw)] sm:w-[300px]">
          <Scaled>
            <BookingMock kind={kind} picked={picked} onPick={setPicked} />
          </Scaled>
        </PhoneFrame>
      </div>
    </div>
  );
}

/** Lays out its child at the real phone size (390x800) and scales it to fit. */
function Scaled({ children }: { children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(274 / 390);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => setScale(entry.contentRect.width / 390));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return (
    <div ref={ref} className="absolute inset-0">
      <div
        className="absolute right-0 top-0 h-[800px] w-[390px] origin-top-right"
        style={{ transform: `scale(${scale})` }}
      >
        {children}
      </div>
    </div>
  );
}

/** The first step of the booking page, with the same classes as app/[slug]/page.tsx. */
function BookingMock({ kind, picked, onPick }: { kind: Kind; picked: number; onPick: (i: number) => void }) {
  const chosen = kind.services[picked];
  return (
    <div className="relative h-full bg-paper text-ink-900">
      <div className="border-b border-ink-200 bg-white/95 px-4 py-2.5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div
              aria-hidden="true"
              className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg bg-brand-600 text-lg font-extrabold text-lime"
            >
              {kind.business.trim().charAt(0)}
            </div>
            <div className="text-right">
              <p key={kind.id} className="l-fade text-base font-bold leading-tight text-ink-900">
                {kind.business}
              </p>
              <div className="flex items-center gap-1.5 text-xs text-ink-500">
                <span className="inline-block h-2 w-2 rounded-full bg-success-500" />
                <span>פתוח להזמנת תורים</span>
              </div>
            </div>
          </div>
          <div aria-hidden="true" className="flex items-center gap-2">
            <span className="flex h-11 w-11 items-center justify-center rounded-lg border border-ink-200 bg-white text-success-700">
              <MessageCircle className="h-5 w-5" />
            </span>
            <span className="flex h-11 w-11 items-center justify-center rounded-lg border border-ink-200 bg-white text-ink-700">
              <Phone className="h-5 w-5" />
            </span>
          </div>
        </div>
      </div>

      <div className="px-4 pt-5">
        <ol aria-hidden="true" className="mb-6 grid grid-cols-4 gap-1.5 text-xs font-semibold text-ink-500">
          {["שירות", "תאריך", "שעה", "פרטים"].map((label, i) => (
            <li key={label} className="flex flex-col gap-1.5">
              <span className={cn("h-1 rounded-full", i === 0 ? "bg-brand-600" : "bg-ink-200")} />
              <span className={cn(i === 0 && "font-bold text-brand-600")}>
                {i + 1}. {label}
              </span>
            </li>
          ))}
        </ol>

        <div className="mb-4 text-right">
          <p className="text-xl font-extrabold text-ink-900">בחר שירות</p>
          <p className="text-sm text-ink-500">בחר את סוג הטיפול או השירות המבוקש</p>
        </div>

        <div key={kind.id} className="space-y-3">
          {kind.services.map((s, i) => {
            const on = i === picked;
            return (
              <button
                key={s.name}
                type="button"
                aria-pressed={on}
                onClick={() => onPick(i)}
                className={cn(
                  "l-in m-press flex w-full items-center justify-between rounded-xl border p-4 text-right",
                  on ? "border-brand-600 bg-brand-50/60 ring-1 ring-brand-600" : "border-ink-200 bg-white hover:border-ink-300"
                )}
                style={{ "--d": `${i * 70}ms` } as React.CSSProperties}
              >
                <span className="flex items-center gap-3">
                  <span
                    aria-hidden="true"
                    data-on={on}
                    className={cn(
                      "flex h-5 w-5 flex-none items-center justify-center rounded-full border transition-colors",
                      on ? "m-chip border-brand-600 bg-brand-600" : "border-ink-300 bg-white"
                    )}
                  >
                    {on && <span className="h-2 w-2 rounded-full bg-lime" />}
                  </span>
                  <span className="text-right">
                    <span className="block text-base font-bold leading-snug text-ink-900">{s.name}</span>
                    <span className="mt-1 flex items-center gap-2 text-xs text-ink-500">
                      <span className="flex items-center gap-1">
                        <Clock className="h-3.5 w-3.5 text-ink-400" />
                        {s.minutes} דקות
                      </span>
                      {s.rest > 0 && <span className="text-ink-400">(+{s.rest} מנוחה)</span>}
                    </span>
                  </span>
                </span>
                <span className="text-lg font-extrabold text-ink-900">₪{s.price}</span>
              </button>
            );
          })}
        </div>
      </div>

      <div
        aria-hidden="true"
        className="absolute inset-x-0 bottom-0 flex items-center gap-3 border-t border-ink-200 bg-white/95 px-4 pb-3 pt-3"
      >
        <div className="min-w-0 flex-1 text-right">
          <span className="text-xs text-ink-500">שירות נבחר</span>
          <p className="truncate text-sm font-bold text-ink-900">{chosen.name}</p>
        </div>
        <span className="m-key inline-flex h-[52px] items-center gap-2.5 rounded-lg bg-brand-600 px-6 text-base font-semibold text-white">
          המשך לבחירת יום
          <ChevronLeft className="h-4 w-4" />
        </span>
      </div>
    </div>
  );
}
