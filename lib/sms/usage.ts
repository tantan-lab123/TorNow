import { TZDate } from "@date-fns/tz";

/** Start of the current calendar month in Israel (Asia/Jerusalem), as a UTC ISO instant. */
export function israelMonthStartIso(now: Date = new Date()): string {
  const il = new TZDate(now.getTime(), "Asia/Jerusalem");
  const start = new TZDate(il.getFullYear(), il.getMonth(), 1, 0, 0, 0, 0, "Asia/Jerusalem");
  return new Date(start.getTime()).toISOString();
}
