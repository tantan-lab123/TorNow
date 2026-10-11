"use client";

import React, { useState } from "react";
import { Pause, Play } from "lucide-react";
import { cn } from "@/lib/utils";
import { LogoMark } from "@/components/brand/Logo";
import { PhoneFrame, Screen } from "./PhoneFrame";
import { REDUCED_MOTION, motionAllowed, useInView, useMedia, usePageVisible } from "./hooks";

type Frame = {
  screen: string;
  label: string;
  caption: string;
  alt: string;
  ms: number;
  /** Where the finger taps before the next screen, in % of the 390x800 screenshot. */
  tap?: { x: number; y: number };
};

// A real booking at the demo barbershop, screen by screen, then the owner's phone.
const CLIENT: Frame[] = [
  {
    screen: "booking-service",
    label: "שירות",
    ms: 2600,
    tap: { x: 27.5, y: 95.3 },
    caption: "הלקוח בוחר שירות, ורואה מחיר ומשך",
    alt: "עמוד ההזמנה של מספרת דניאל: רשימת שירותים עם משך ומחיר",
  },
  {
    screen: "booking-day",
    label: "יום",
    ms: 2400,
    tap: { x: 62, y: 62.9 },
    caption: "בלוח מסומנים רק ימים שיש בהם מקום",
    alt: "בחירת יום בלוח של אוקטובר, עם סימון לימים שיש בהם מקום",
  },
  {
    screen: "booking-time",
    label: "שעה",
    ms: 2600,
    tap: { x: 38.3, y: 79.1 },
    caption: "בוחר בוקר, צהריים או ערב, ואז שעה פנויה",
    alt: "בחירת שעה: לשוניות בוקר, צהריים וערב, ומתחתן השעות הפנויות",
  },
  {
    screen: "booking-details",
    label: "פרטים",
    ms: 3000,
    tap: { x: 36.5, y: 95.3 },
    caption: "לקוח חוזר מזוהה לפי הטלפון, והפרטים מתמלאים לבד",
    alt: "מסך הפרטים: הלקוח זוהה לפי מספר הטלפון והשם מולא לבד",
  },
  {
    screen: "booking-done",
    label: "נקבע",
    ms: 2600,
    caption: "התור נקבע, עם הוספה ליומן וקישור לביטול",
    alt: "אישור: התור נקבע ליום שלישי, 13 באוקטובר, ב-11:30",
  },
];

const OWNER: Frame = {
  screen: "owner-calendar",
  label: "אצלכם",
  ms: 4200,
  caption: "ואצלכם: התראה בטלפון, והתור כבר ביומן",
  alt: "היומן של בעל העסק: התור הבא, מספר התורים והכנסה צפויה להיום",
};

// With two phones side by side the last client screen waits for the owner's banner.
const DONE_WITH_OWNER = { ms: 4400, caption: "התור נקבע, ובטלפון שלכם כבר קופצת התראה" };

/**
 * The hero demo: the booking flow plays on the client's phone, a finger taps through
 * it, and the new booking lands on the owner's phone. Wide screens show both phones;
 * phones show one, with the owner's screen as a last step. The progress fill under the
 * active step is the clock: when it ends, the next screen shows.
 */
export function HeroDemo() {
  const twoPhones = useMedia("(min-width: 768px)");
  const reduced = useMedia(REDUCED_MOTION);
  const pageVisible = usePageVisible();
  const [rootRef, inView] = useInView<HTMLDivElement>(0.35);
  const [step, setStep] = useState(0);
  const [run, setRun] = useState(0);
  const [paused, setPaused] = useState(false);

  const count = twoPhones ? CLIENT.length : CLIENT.length + 1;
  const current = Math.min(step, count - 1);
  const ownerStep = !twoPhones && current === CLIENT.length;
  const doneWithOwner = twoPhones && current === CLIENT.length - 1;
  const frame = ownerStep ? OWNER : CLIENT[current];
  const ms = doneWithOwner ? DONE_WITH_OWNER.ms : frame.ms;
  const caption = doneWithOwner ? DONE_WITH_OWNER.caption : frame.caption;

  const playing = !paused && !reduced && inView && pageVisible;
  const playState: React.CSSProperties["animationPlayState"] = playing ? "running" : "paused";

  const advance = () => {
    if (!motionAllowed()) return;
    setStep((s) => (Math.min(s, count - 1) + 1) % count);
  };
  const pick = (i: number) => {
    setStep(i);
    setRun((r) => r + 1);
  };

  return (
    <div ref={rootRef} role="group" aria-label="הדגמה: לקוח קובע תור מהטלפון, והתור מגיע לבעל העסק">
      <div className="flex items-start justify-center">
        {/* The client's phone */}
        <div className="w-[min(280px,74vw)] md:w-[250px] xl:w-[232px]">
          <p className="mb-3 hidden items-center gap-2 text-[13px] font-bold text-ink-600 md:flex">
            <span aria-hidden="true" className="h-2 w-2 bg-ink-900" />
            הטלפון של הלקוח
          </p>
          <PhoneFrame>
            {CLIENT.map((f, i) => (
              <Screen
                key={f.screen}
                name={f.screen}
                alt={f.alt}
                eager
                hidden={i !== current || ownerStep}
                className={cn(
                  "l-screen",
                  i === current && !ownerStep
                    ? "opacity-100"
                    : i < current || ownerStep
                      ? "translate-x-[14%] opacity-0"
                      : "-translate-x-[14%] opacity-0"
                )}
              />
            ))}
            {!twoPhones && (
              <>
                <Screen
                  name={OWNER.screen}
                  alt={OWNER.alt}
                  eager
                  hidden={!ownerStep}
                  className={cn("l-screen", ownerStep ? "opacity-100" : "-translate-x-[14%] opacity-0")}
                />
                <PushBanner on={ownerStep} />
              </>
            )}
            {frame.tap && !reduced && (
              <span
                key={`tap-${current}-${run}`}
                aria-hidden="true"
                className="l-tap"
                style={{
                  left: `${frame.tap.x}%`,
                  top: `${frame.tap.y}%`,
                  animationDelay: `${Math.round(ms * 0.6)}ms`,
                  animationPlayState: playState,
                }}
              />
            )}
          </PhoneFrame>
        </div>

        {/* The booking travels across */}
        <div aria-hidden="true" className="relative hidden w-11 self-center md:block xl:w-10">
          <span className="block border-t border-dashed border-ink-400" />
          {doneWithOwner && !reduced && (
            <span
              key={`travel-${run}`}
              className="l-travel absolute inset-x-0 top-0"
              style={{ animationDelay: "250ms", animationPlayState: playState }}
            >
              <span className="absolute -top-[5px] right-0 h-[9px] w-[9px] border border-lime-edge bg-lime" />
            </span>
          )}
        </div>

        {/* The owner's phone */}
        <div className="hidden w-[250px] md:block xl:w-[232px]">
          <p className="mb-3 flex items-center gap-2 text-[13px] font-bold text-ink-600">
            <span aria-hidden="true" className="h-2 w-2 border border-lime-edge bg-lime" />
            הטלפון שלכם
          </p>
          <div className="mt-10">
            <PhoneFrame>
              <Screen name={OWNER.screen} alt={OWNER.alt} eager />
              <PushBanner on={doneWithOwner} />
            </PhoneFrame>
          </div>
        </div>
      </div>

      {/* Steps: the fill under the active step drives the demo */}
      <div className="mx-auto mt-8 max-w-[540px]">
        <div className="flex items-start gap-3">
          <ol className="grid flex-1 grid-cols-6 gap-1.5 md:grid-cols-5">
            {[...CLIENT, OWNER].map((f, i) => {
              const active = i === current;
              const done = i < current;
              return (
                <li key={f.screen} className={cn(i === CLIENT.length && "md:hidden")}>
                  <button
                    type="button"
                    onClick={() => pick(i)}
                    aria-current={active ? "step" : undefined}
                    aria-label={`שלב ${i + 1}: ${f.label}`}
                    className="group block w-full pb-1 pt-2 text-right"
                  >
                    <span className="block h-[3px] overflow-hidden bg-ink-200">
                      {active && !reduced ? (
                        <span
                          key={`${current}-${run}`}
                          className="l-fill block h-full bg-brand-600"
                          style={{ animationDuration: `${ms}ms`, animationPlayState: playState }}
                          onAnimationEnd={advance}
                        />
                      ) : (
                        <span
                          className={cn(
                            "block h-full origin-right bg-brand-600 transition-transform duration-300",
                            active || done ? "scale-x-100" : "scale-x-0 group-hover:scale-x-[0.25]"
                          )}
                        />
                      )}
                    </span>
                    <span
                      className={cn(
                        "mt-2 block text-[11px] font-bold transition-colors sm:text-xs",
                        active ? "text-brand-600" : done ? "text-ink-700" : "text-ink-500 group-hover:text-ink-700"
                      )}
                    >
                      {f.label}
                    </span>
                  </button>
                </li>
              );
            })}
          </ol>
          {!reduced && (
            <button
              type="button"
              onClick={() => setPaused((p) => !p)}
              aria-label={paused ? "המשך ההדגמה" : "השהיית ההדגמה"}
              className="m-press grid h-10 w-10 flex-none place-items-center border border-ink-300 bg-white text-ink-800 hover:border-ink-500"
            >
              {paused ? <Play className="h-4 w-4" /> : <Pause className="h-4 w-4" />}
            </button>
          )}
        </div>
        <p
          key={`${current}-${twoPhones}`}
          className="l-fade mt-4 min-h-[3em] text-center text-[15px] leading-snug text-ink-700 sm:text-base"
        >
          {caption}
        </p>
      </div>
    </div>
  );
}

/** The push notification the owner gets (same wording as the real one). */
function PushBanner({ on }: { on: boolean }) {
  return (
    <div
      aria-hidden={!on}
      data-on={on}
      className="l-banner absolute inset-x-[3.5%] top-[1.6%] z-10 flex gap-[2.8cqw] rounded-[5cqw] border border-ink-200 bg-white/95 p-[3.2cqw] text-right shadow-[0_14px_30px_-14px_rgba(23,32,26,0.5)] backdrop-blur-md"
    >
      <span className="h-[9cqw] w-[9cqw] flex-none [&>svg]:h-full [&>svg]:w-full">
        <LogoMark size={32} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center justify-between text-[length:2.9cqw] text-ink-500">
          <span className="font-bold tracking-wide">Torli</span>
          <span>עכשיו</span>
        </span>
        <span className="block text-[length:3.6cqw] font-extrabold leading-tight text-ink-900">תור חדש נקבע</span>
        <span className="block text-[length:3.2cqw] leading-snug text-ink-700">
          איתי מזרחי · תספורת גברים קלאסית · יום שלישי, 13 באוקטובר 11:30
        </span>
      </span>
    </div>
  );
}
