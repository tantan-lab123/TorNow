"use client";

import React, { useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { PhoneFrame, Screen } from "./PhoneFrame";
import { REDUCED_MOTION, motionAllowed, useInView, useMedia, usePageVisible } from "./hooks";

const TABS = [
  {
    screen: "owner-calendar",
    title: "היום שלכם",
    text: "התור הבא מודגש למעלה, עם וואטסאפ וחיוג בלחיצה. מתחתיו כל התורים של היום, ההכנסה הצפויה והביטולים.",
    alt: "מסך היומן: כרטיס התור הבא, ספירת התורים של היום והכנסה צפויה",
  },
  {
    screen: "owner-actions",
    title: "פעולה מהירה",
    text: "כפתור אחד באמצע המסך: תור חדש ללקוח שהתקשר, חסימת זמן להפסקה, או שיתוף הקישור להזמנה.",
    alt: "תפריט הפעולות המהירות: תור חדש, חסימת זמן או הפסקה, ושיתוף הקישור להזמנה",
  },
  {
    screen: "owner-customers",
    title: "לקוחות",
    text: "כל לקוח עם מספר התורים, הביטולים וסך הרכישות. חיפוש לפי שם או טלפון, ייבוא אנשי קשר וייצוא לאקסל.",
    alt: "רשימת הלקוחות עם חיפוש, ייבוא אנשי קשר וייצוא לאקסל",
  },
  {
    screen: "owner-stats",
    title: "מספרים",
    text: "הכנסות, תורים, ביטולים ולקוחות, להיום, לשבוע האחרון או לחודש כולו.",
    alt: "מסך הסטטיסטיקה: הכנסות, תורים מאושרים, ביטולים ולקוחות של היום",
  },
];

const TAB_MS = 5200;

/** The owner's app in four tabs. It plays by itself until a tab is picked. */
export function OwnerTour() {
  const reduced = useMedia(REDUCED_MOTION);
  const pageVisible = usePageVisible();
  const [rootRef, inView] = useInView<HTMLDivElement>(0.35);
  const [active, setActive] = useState(0);
  const [auto, setAuto] = useState(true);
  const tabs = useRef<(HTMLButtonElement | null)[]>([]);

  const running = auto && !reduced && inView && pageVisible;
  const advance = () => {
    if (!motionAllowed()) return;
    setActive((a) => (a + 1) % TABS.length);
  };
  const pick = (i: number) => {
    setAuto(false);
    setActive(i);
  };
  const onKeyDown = (e: React.KeyboardEvent) => {
    const step = e.key === "ArrowLeft" || e.key === "ArrowDown" ? 1 : e.key === "ArrowRight" || e.key === "ArrowUp" ? -1 : 0;
    if (!step) return;
    e.preventDefault();
    const next = (active + step + TABS.length) % TABS.length;
    pick(next);
    tabs.current[next]?.focus();
  };

  return (
    <div ref={rootRef} className="grid items-center gap-12 lg:grid-cols-[minmax(0,1fr)_auto] lg:gap-24">
      <div>
        <div
          role="tablist"
          aria-label="מסכים באפליקציה של בעל העסק"
          onKeyDown={onKeyDown}
          className="grid grid-cols-2 gap-px border border-ink-200 bg-ink-200 lg:grid-cols-1 lg:gap-0 lg:border-x-0 lg:border-b-0 lg:bg-transparent"
        >
          {TABS.map((t, i) => {
            const on = i === active;
            return (
              <button
                key={t.screen}
                ref={(el) => {
                  tabs.current[i] = el;
                }}
                type="button"
                role="tab"
                id={`owner-tab-${i}`}
                aria-selected={on}
                aria-controls="owner-panel"
                tabIndex={on ? 0 : -1}
                onClick={() => pick(i)}
                className="group relative bg-paper px-4 py-4 text-right lg:border-b lg:border-ink-200 lg:bg-transparent lg:px-0 lg:py-7"
              >
                <span className="flex items-baseline gap-3">
                  <span className={cn("text-xs font-bold tabular-nums", on ? "text-brand-600" : "text-ink-500")}>
                    0{i + 1}
                  </span>
                  <span
                    className={cn(
                      "text-[17px] font-extrabold tracking-tight transition-colors lg:text-[26px]",
                      on ? "text-ink-900" : "text-ink-500 group-hover:text-ink-800"
                    )}
                  >
                    {t.title}
                  </span>
                </span>
                <span
                  className={cn(
                    "ms-8 mt-2 hidden max-w-[46ch] text-[16px] leading-relaxed transition-colors lg:block",
                    on ? "text-ink-700" : "text-ink-500"
                  )}
                >
                  {t.text}
                </span>
                <span aria-hidden="true" className="absolute inset-x-0 bottom-0 h-[2px] overflow-hidden lg:bottom-[-1px]">
                  {on &&
                    (auto && !reduced ? (
                      <span
                        key={`fill-${i}`}
                        className="l-fill block h-full bg-brand-600"
                        style={{ animationDuration: `${TAB_MS}ms`, animationPlayState: running ? "running" : "paused" }}
                        onAnimationEnd={advance}
                      />
                    ) : (
                      <span className="block h-full bg-brand-600" />
                    ))}
                </span>
              </button>
            );
          })}
        </div>
        <p key={active} className="l-fade mt-5 text-[16px] leading-relaxed text-ink-700 lg:hidden">
          {TABS[active].text}
        </p>
      </div>

      <div
        id="owner-panel"
        role="tabpanel"
        aria-labelledby={`owner-tab-${active}`}
        className="justify-self-center lg:justify-self-end"
      >
        <PhoneFrame className="w-[min(290px,78vw)] sm:w-[300px]">
          {TABS.map((t, i) => (
            <Screen
              key={t.screen}
              name={t.screen}
              alt={t.alt}
              hidden={i !== active}
              className={cn("l-screen", i === active ? "opacity-100" : "scale-[1.03] opacity-0")}
            />
          ))}
        </PhoneFrame>
      </div>
    </div>
  );
}
