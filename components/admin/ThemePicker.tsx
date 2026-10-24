"use client";

import React, { useRef } from "react";
import { Check } from "lucide-react";
import { THEME_PRESETS, getTheme, themeCssVars } from "@/lib/theme";
import { cn } from "@/lib/utils";

interface ThemePickerProps {
  /** A preset id (anything unknown shows as the default theme) */
  value: string;
  onChange: (id: string) => void;
}

/**
 * "The colour of your page": round swatches (one per preset) and a small live preview.
 * It is a radio group: one tab stop, arrow keys move between the colours.
 */
export function ThemePicker({ value, onChange }: ThemePickerProps) {
  const current = getTheme(value);
  const refs = useRef<(HTMLButtonElement | null)[]>([]);

  const move = (from: number, step: number) => {
    const next = (from + step + THEME_PRESETS.length) % THEME_PRESETS.length;
    onChange(THEME_PRESETS[next].id);
    refs.current[next]?.focus();
  };

  return (
    <div className="sm:col-span-2 pt-4 border-t border-slate-100 space-y-3">
      <div>
        <span id="theme-picker-label" className="text-xs font-bold text-slate-800 block">
          צבע העמוד שלך
        </span>
        <span className="text-[11px] text-ink-500">
          הצבע של דף קביעת התורים ושל דף ניהול התור שהלקוח מקבל ב-SMS. מערכת הניהול נשארת באותו עיצוב.
        </span>
      </div>

      <div role="radiogroup" aria-labelledby="theme-picker-label" className="flex flex-wrap gap-3">
        {THEME_PRESETS.map((p, i) => {
          const on = p.id === current.id;
          return (
            <button
              key={p.id}
              ref={(el) => {
                refs.current[i] = el;
              }}
              type="button"
              role="radio"
              aria-checked={on}
              aria-label={p.label}
              title={p.label}
              tabIndex={on ? 0 : -1}
              onClick={() => onChange(p.id)}
              onKeyDown={(e) => {
                // in a right-to-left page the arrows follow the reading direction
                if (e.key === "ArrowLeft" || e.key === "ArrowDown") {
                  e.preventDefault();
                  move(i, 1);
                } else if (e.key === "ArrowRight" || e.key === "ArrowUp") {
                  e.preventDefault();
                  move(i, -1);
                }
              }}
              className={cn(
                "relative flex h-11 w-11 items-center justify-center rounded-full border-2 transition-shadow",
                on ? "border-ink-900 shadow-md" : "border-white shadow-sm hover:shadow-md"
              )}
              style={{ backgroundColor: p.brand[600] }}
            >
              <span
                aria-hidden="true"
                className="absolute bottom-0.5 left-0.5 h-3.5 w-3.5 rounded-full border border-white"
                style={{ backgroundColor: p.accent.base }}
              />
              {on && <Check className="h-5 w-5 text-white" aria-hidden="true" />}
            </button>
          );
        })}
      </div>
      <p className="text-xs font-semibold text-ink-700">
        הצבע שנבחר: <span>{current.label}</span>
      </p>

      {/* Preview: the page's own classes, wearing the chosen colours */}
      <div
        className="flex flex-wrap items-center gap-3 rounded-2xl border border-slate-200 bg-paper p-3.5"
        style={themeCssVars(current.id) as React.CSSProperties}
        aria-hidden="true"
      >
        <span className="inline-flex h-11 items-center rounded-lg bg-brand-600 px-5 text-sm font-bold text-white">
          קביעת תור
        </span>
        <span className="inline-flex h-8 items-center rounded-full bg-lime px-3 text-xs font-bold text-lime-ink">
          15:30
        </span>
        <span className="inline-flex h-8 items-center rounded-full border border-brand-200 bg-brand-50 px-3 text-xs font-bold text-brand-700">
          תספורת
        </span>
      </div>
    </div>
  );
}
