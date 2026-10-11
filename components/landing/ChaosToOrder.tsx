"use client";

import React, { useEffect, useRef, useState } from "react";
import { Check, MessageCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import { LogoMark } from "@/components/brand/Logo";
import { REDUCED_MOTION, useMedia } from "./hooks";

type Item = {
  who: string;
  color: string;
  at: string;
  text: string;
  done: string;
  when: string;
  cancelled?: boolean;
  /** How the message sits on the pile before it is straightened. */
  tilt: number;
  x: number;
  y: number;
};

// Every message here is something Torli lets the client do alone.
const ITEMS: Item[] = [
  { who: "אבי", color: "#2F6B4B", at: "07:58", text: "היי, יש לך משהו מחר בבוקר?", done: "קבע תור לבד", when: "מחר · 09:30", tilt: -2.6, x: 12, y: 3 },
  { who: "שירן", color: "#7A3B69", at: "08:12", text: "אפשר להזיז את התור שלי לחמישי?", done: "העבירה את התור לבד", when: "חמישי · 16:00", tilt: 1.9, x: -14, y: -2 },
  { who: "דנה", color: "#B4532A", at: "08:47", text: "כמה עולה טיפול? יש מקום השבוע?", done: "ראתה מחירון וקבעה", when: "ראשון · 12:15", tilt: -1.4, x: 6, y: 5 },
  { who: "רועי", color: "#1E4D36", at: "09:20", text: "שכחתי מתי קבענו, תזכיר לי?", done: "הוסיף את התור ליומן שלו", when: "שני · 18:00", tilt: 2.7, x: -9, y: -3 },
  { who: "ליאת", color: "#A56F06", at: "09:41", text: "משהו קפץ לי, אפשר לבטל להיום?", done: "ביטלה לבד, והשעה התפנתה", when: "היום · 14:00", cancelled: true, tilt: -2, x: 14, y: 2 },
];

/**
 * The pain section's board: a pile of client messages that straightens into a tidy list
 * of bookings. It switches by itself once, a few seconds after it is seen, unless the
 * visitor has already used the toggle.
 */
export function ChaosToOrder() {
  const reduced = useMedia(REDUCED_MOTION);
  const [order, setOrder] = useState(false);
  const touched = useRef(false);
  const boardRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = boardRef.current;
    if (!el || reduced) return;
    let timer = 0;
    const io = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting) return;
        io.disconnect();
        timer = window.setTimeout(() => {
          if (!touched.current) setOrder(true);
        }, 3200);
      },
      { threshold: 0.6 }
    );
    io.observe(el);
    return () => {
      io.disconnect();
      window.clearTimeout(timer);
    };
  }, [reduced]);

  const choose = (next: boolean) => {
    touched.current = true;
    setOrder(next);
  };

  const segment = "relative z-10 h-11 rounded-[7px] text-[15px] font-bold transition-colors duration-300";

  return (
    <div>
      <div
        role="group"
        aria-label="להשוות בין העבודה בלי Torli לעבודה עם Torli"
        className="relative grid w-full max-w-[340px] grid-cols-2 rounded-[10px] border border-brand-500/70 bg-brand-800 p-1"
      >
        <span
          aria-hidden="true"
          className="absolute inset-y-1 right-1 w-[calc(50%-4px)] rounded-[7px] bg-paper transition-transform duration-500 [transition-timing-function:var(--m-spring)]"
          style={{ transform: order ? "translateX(-100%)" : undefined }}
        />
        <button
          type="button"
          aria-pressed={!order}
          onClick={() => choose(false)}
          className={cn(segment, !order ? "text-ink-900" : "text-paper/75 hover:text-paper")}
        >
          בלי Torli
        </button>
        <button
          type="button"
          aria-pressed={order}
          onClick={() => choose(true)}
          className={cn(segment, order ? "text-ink-900" : "text-paper/75 hover:text-paper")}
        >
          עם Torli
        </button>
      </div>

      <div
        ref={boardRef}
        className="mt-5 rounded-[14px] bg-paper p-4 text-ink-900 shadow-[0_30px_60px_-30px_rgba(0,0,0,0.6)] sm:p-6"
      >
        <div className="flex items-center justify-between gap-3 border-b border-ink-200 pb-4">
          <span className="flex items-center gap-2.5 text-[15px] font-extrabold">
            <span className="grid h-6 w-6 [&>*]:col-start-1 [&>*]:row-start-1">
              <MessageCircle className={cn("l-face h-6 w-6 text-success-600", order && "opacity-0")} />
              <span className={cn("l-face", !order && "opacity-0")}>
                <LogoMark size={24} />
              </span>
            </span>
            <span className="grid [&>*]:col-start-1 [&>*]:row-start-1">
              <span className={cn("l-face", order && "opacity-0")}>הוואטסאפ של העסק</span>
              <span className={cn("l-face", !order && "opacity-0")}>היומן ב-Torli</span>
            </span>
          </span>
          <span
            className={cn(
              "whitespace-nowrap rounded px-2 py-1 text-xs font-bold transition-colors duration-300",
              order ? "bg-lime text-lime-ink" : "bg-danger-50 text-danger-700"
            )}
          >
            {order ? "אין על מה לענות" : "5 מחכות לתשובה"}
          </span>
        </div>

        <ul className="mt-4 space-y-2.5">
          {ITEMS.map((it, i) => (
            <li key={it.who} data-reveal="" style={{ "--rv-delay": `${i * 80}ms` } as React.CSSProperties}>
              <div
                className="l-morph relative h-[66px]"
                style={{
                  transform: order ? undefined : `translate(${it.x}px, ${it.y}px) rotate(${it.tilt}deg)`,
                  transitionDelay: `${(order ? i : ITEMS.length - 1 - i) * 60}ms`,
                }}
              >
                {/* The message */}
                <div
                  aria-hidden={order}
                  className={cn(
                    "l-face absolute inset-0 flex items-center gap-3 rounded-[12px] border border-ink-200 bg-white px-3 shadow-[0_10px_22px_-14px_rgba(23,32,26,0.45)]",
                    order && "opacity-0"
                  )}
                >
                  <span
                    className="grid h-9 w-9 flex-none place-items-center rounded-full text-sm font-extrabold text-white"
                    style={{ background: it.color }}
                  >
                    {it.who.charAt(0)}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center justify-between gap-2">
                      <span className="text-[14px] font-bold">{it.who}</span>
                      <span className="text-[11px] tabular-nums text-ink-500">{it.at}</span>
                    </span>
                    <span className="block truncate text-[14px] text-ink-700">{it.text}</span>
                  </span>
                  <span aria-hidden="true" className="h-2 w-2 flex-none rounded-full bg-success-500" />
                </div>

                {/* What happened instead */}
                <div
                  aria-hidden={!order}
                  className={cn(
                    "l-face absolute inset-0 flex items-center gap-3 border-b border-ink-200 px-1",
                    !order && "opacity-0"
                  )}
                >
                  <span className="grid h-9 w-9 flex-none place-items-center border border-lime-edge bg-lime">
                    <Check className="h-4 w-4 text-lime-ink" strokeWidth={3} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-[14px] font-bold">{it.who}</span>
                    <span className="block truncate text-[14px] text-ink-700">{it.done}</span>
                  </span>
                  <span
                    className={cn(
                      "whitespace-nowrap text-[13px] font-bold tabular-nums",
                      it.cancelled ? "text-ink-500 line-through" : "text-ink-900"
                    )}
                  >
                    {it.when}
                  </span>
                </div>
              </div>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
