"use client";

import React, { useMemo } from "react";
import { CalendarX, ChevronLeft, ChevronRight } from "lucide-react";
import {
  addMonths,
  differenceInCalendarDays,
  eachDayOfInterval,
  endOfMonth,
  format,
  getDay,
  isBefore,
  isSameDay,
  isSameMonth,
  startOfMonth,
  startOfToday,
  subMonths,
} from "date-fns";
import { he } from "date-fns/locale";
import type { DateOverride } from "@/lib/types";
import { cn, formatHebrewDate, getHebrewDayLetter, getJewishHolidayOrShabbat } from "@/lib/utils";

const WEEKDAYS = ["א׳", "ב׳", "ג׳", "ד׳", "ה׳", "ו׳", "ש׳"];

// Cells sit on the hairline colour (gap-px), so their backgrounds must be opaque.
const OUTSIDE = "bg-[#F7F5EE]";
// Closed days are ruled through, like a blocked day in a paper diary.
const HATCH = "[background-image:repeating-linear-gradient(135deg,transparent_0_5px,rgba(23,32,26,0.07)_5px_6px)]";
const HATCH_DANGER =
  "[background-image:repeating-linear-gradient(135deg,transparent_0_5px,rgba(158,52,32,0.12)_5px_6px)]";

type Closure = { from: Date; to: Date; reason: string };

/**
 * The owner's month as a ruled table: a row per week and a hairline between days. A day
 * with bookings shows how many, closed days are ruled through, and today is lime.
 * Tapping a day opens it for viewing, closing or reopening.
 */
export function MonthTable({
  month,
  onMonthChange,
  selectedDate,
  countByDate,
  isOpenOnDay,
  getOverride,
  showHebrewDates,
  onPickDay,
  onCloseRange,
}: {
  month: Date;
  onMonthChange: (month: Date) => void;
  selectedDate: Date;
  countByDate: Record<string, number>;
  isOpenOnDay: (day: Date) => boolean;
  getOverride: (day: Date) => DateOverride | undefined;
  showHebrewDates: boolean;
  onPickDay: (day: Date) => void;
  onCloseRange: () => void;
}) {
  const today = startOfToday();
  const days = useMemo(() => eachDayOfInterval({ start: startOfMonth(month), end: endOfMonth(month) }), [month]);
  const lead = getDay(days[0]);
  const trail = (7 - ((lead + days.length) % 7)) % 7;
  const total = days.reduce((n, d) => n + (countByDate[format(d, "yyyy-MM-dd")] || 0), 0);

  // Runs of closed days with the same reason, listed under the table.
  const closures = useMemo(() => {
    const runs: Closure[] = [];
    for (const day of days) {
      const o = getOverride(day);
      if (!o?.is_closed) continue;
      const reason = o.reason || "סגור";
      const last = runs[runs.length - 1];
      if (last && last.reason === reason && differenceInCalendarDays(day, last.to) === 1) last.to = day;
      else runs.push({ from: day, to: day, reason });
    }
    return runs;
  }, [days, getOverride]);

  const navButton =
    "m-press grid h-9 w-9 place-items-center rounded-md border border-ink-200 bg-white text-ink-700 hover:bg-paper";

  return (
    <div className="overflow-hidden rounded-xl border border-ink-200 bg-white">
      <div className="flex items-center justify-between gap-3 px-4 py-3.5 sm:px-5">
        <div className="min-w-0">
          <h3 className="text-lg font-extrabold leading-tight text-ink-900">
            {format(month, "MMMM yyyy", { locale: he })}
          </h3>
          <p className="mt-0.5 text-xs text-ink-500">
            {total > 0 ? `${total} ${total === 1 ? "תור" : "תורים"} בחודש` : "אין תורים בחודש הזה"}
          </p>
        </div>
        <div className="flex flex-none items-center gap-1.5">
          {!isSameMonth(month, today) && (
            <button
              type="button"
              onClick={() => onMonthChange(startOfMonth(today))}
              className="m-press h-9 rounded-md border border-ink-200 bg-white px-3 text-[13px] font-bold text-ink-800 hover:bg-paper"
            >
              היום
            </button>
          )}
          <button type="button" aria-label="חודש קודם" onClick={() => onMonthChange(subMonths(month, 1))} className={navButton}>
            <ChevronRight className="h-5 w-5" />
          </button>
          <button type="button" aria-label="חודש הבא" onClick={() => onMonthChange(addMonths(month, 1))} className={navButton}>
            <ChevronLeft className="h-5 w-5" />
          </button>
        </div>
      </div>

      {/* The table */}
      <div className={cn("grid grid-cols-7 border-y border-ink-200", OUTSIDE)}>
        {WEEKDAYS.map((d) => (
          <div key={d} className="py-2 text-center text-[11px] font-bold text-ink-500">
            {d}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-px bg-ink-200">
        {Array.from({ length: lead }).map((_, i) => (
          <div key={`lead-${i}`} className={OUTSIDE} />
        ))}
        {days.map((day) => {
          const key = format(day, "yyyy-MM-dd");
          const count = countByDate[key] || 0;
          const past = isBefore(day, today);
          const isToday = isSameDay(day, today);
          const override = getOverride(day);
          const closedByOwner = !!override?.is_closed;
          // A special opening (an override that is not closed) wins over the weekly day off.
          const closedWeekly = !override && !isOpenOnDay(day);
          const holiday = showHebrewDates ? getJewishHolidayOrShabbat(day) : null;
          const label = [
            formatHebrewDate(day),
            closedByOwner ? `סגור: ${override?.reason || "סגור"}` : closedWeekly ? "סגור קבוע" : null,
            count ? `${count} ${count === 1 ? "תור" : "תורים"}` : null,
          ]
            .filter(Boolean)
            .join(", ");

          return (
            <button
              key={key}
              type="button"
              onClick={() => onPickDay(day)}
              aria-label={label}
              aria-current={isToday ? "date" : undefined}
              title={closedByOwner ? override?.reason : undefined}
              className={cn(
                "relative flex min-h-[64px] flex-col gap-1 p-1.5 text-right transition-colors focus-visible:z-10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-600 sm:min-h-[88px] sm:p-2",
                closedByOwner
                  ? cn("bg-danger-50 hover:bg-danger-100", HATCH_DANGER)
                  : closedWeekly
                    ? cn("bg-paper hover:bg-ink-100", HATCH)
                    : past
                      ? "bg-[#FBFAF5] hover:bg-paper"
                      : "bg-white hover:bg-paper",
                isSameDay(day, selectedDate) && "shadow-[inset_0_0_0_2px_#1E4D36]"
              )}
            >
              <span className="flex items-start justify-between gap-1">
                <span
                  className={cn(
                    "grid h-6 min-w-6 place-items-center rounded px-1 text-[13px] font-bold leading-none tabular-nums",
                    isToday
                      ? "bg-lime text-lime-ink"
                      : past
                        ? "text-ink-400"
                        : closedByOwner
                          ? "text-danger-700"
                          : "text-ink-900"
                  )}
                >
                  {format(day, "d")}
                </span>
                {showHebrewDates && (
                  <span className="pt-1 text-[10px] font-bold leading-none text-ink-400">{getHebrewDayLetter(day)}</span>
                )}
              </span>
              {holiday && (
                <span className="line-clamp-2 text-[9px] font-bold leading-tight text-pending-700 sm:text-[10px]">
                  {holiday}
                </span>
              )}
              <span className="mt-auto flex flex-wrap items-center gap-1">
                {(closedByOwner || closedWeekly) && (
                  <span
                    className={cn(
                      "text-[10px] font-bold leading-none sm:text-[11px]",
                      closedByOwner ? "text-danger-700" : "text-ink-400"
                    )}
                  >
                    סגור
                  </span>
                )}
                {count > 0 && (
                  <span
                    className={cn(
                      "grid h-5 min-w-5 place-items-center rounded px-1 text-[11px] font-bold tabular-nums",
                      past || closedByOwner || closedWeekly ? "bg-ink-200 text-ink-600" : "bg-brand-600 text-white"
                    )}
                  >
                    {count}
                  </span>
                )}
                {count > 0 && !closedByOwner && !closedWeekly && (
                  <span className="hidden text-[11px] text-ink-500 sm:inline">{count === 1 ? "תור" : "תורים"}</span>
                )}
              </span>
            </button>
          );
        })}
        {Array.from({ length: trail }).map((_, i) => (
          <div key={`trail-${i}`} className={OUTSIDE} />
        ))}
      </div>

      {/* Key */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-ink-200 px-4 py-3 text-xs text-ink-600 sm:px-5">
        <span className="flex items-center gap-1.5">
          <span className="h-3.5 w-3.5 rounded-sm border border-ink-300 bg-white" />
          פתוח
        </span>
        <span className="flex items-center gap-1.5">
          <span className={cn("h-3.5 w-3.5 rounded-sm border border-ink-300 bg-paper", HATCH)} />
          סגור קבוע
        </span>
        <span className="flex items-center gap-1.5">
          <span className={cn("h-3.5 w-3.5 rounded-sm border border-danger-200 bg-danger-50", HATCH_DANGER)} />
          חופשה או סגירה
        </span>
        <span className="flex items-center gap-1.5">
          <span className="grid h-4 min-w-4 place-items-center rounded-sm bg-brand-600 px-0.5 text-[9px] font-bold text-white">
            3
          </span>
          תורים ביום
        </span>
      </div>

      {/* Closed stretches and closing a range */}
      <div className="border-t border-ink-200 px-4 py-4 sm:px-5">
        {closures.length > 0 && (
          <div className="mb-4">
            <h4 className="text-xs font-bold text-ink-500">ימים סגורים בחודש</h4>
            <ul className="mt-2 divide-y divide-ink-200 border-y border-ink-200">
              {closures.map((c) => (
                <li key={format(c.from, "yyyy-MM-dd")}>
                  <button
                    type="button"
                    onClick={() => onPickDay(c.from)}
                    className="w-full py-2.5 text-right text-sm hover:bg-paper"
                  >
                    <span className="font-bold tabular-nums text-ink-900">
                      {isSameDay(c.from, c.to)
                        ? format(c.from, "d בMMMM", { locale: he })
                        : `${format(c.from, "d")}-${format(c.to, "d בMMMM", { locale: he })}`}
                    </span>
                    <span className="text-ink-600"> · {c.reason}</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
        <button
          type="button"
          onClick={onCloseRange}
          className="m-key2 flex h-11 w-full items-center justify-center gap-2 rounded-lg border border-ink-200 bg-white text-sm font-bold text-ink-900"
        >
          <CalendarX className="h-4 w-4" />
          סגירת שבוע או חופשה
        </button>
      </div>
    </div>
  );
}
