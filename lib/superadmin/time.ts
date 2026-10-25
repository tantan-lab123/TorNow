import { TZDate } from "@date-fns/tz";

/** Days and months of the dashboard are Israel calendar days and months (summer time included). */
export const DASHBOARD_TZ = "Asia/Jerusalem";

const pad = (n: number) => String(n).padStart(2, "0");

/** The first instant of the Israel calendar day that is `offsetDays` from the day `now` falls in. */
export function israelDayStart(now: Date, offsetDays = 0): Date {
  const l = new TZDate(now.getTime(), DASHBOARD_TZ);
  return new Date(new TZDate(l.getFullYear(), l.getMonth(), l.getDate() + offsetDays, 0, 0, 0, 0, DASHBOARD_TZ).getTime());
}

/** The first instant of the Israel calendar month that is `monthsBack` months before the month of `now`. */
export function israelMonthStart(now: Date, monthsBack = 0): Date {
  const l = new TZDate(now.getTime(), DASHBOARD_TZ);
  return new Date(new TZDate(l.getFullYear(), l.getMonth() - monthsBack, 1, 0, 0, 0, 0, DASHBOARD_TZ).getTime());
}

/** "2026-10-25": the Israel calendar day an instant falls in. */
export function dayKey(d: Date): string {
  const l = new TZDate(d.getTime(), DASHBOARD_TZ);
  return `${l.getFullYear()}-${pad(l.getMonth() + 1)}-${pad(l.getDate())}`;
}

/** "2026-10": the Israel calendar month an instant falls in. */
export function monthKey(d: Date): string {
  const l = new TZDate(d.getTime(), DASHBOARD_TZ);
  return `${l.getFullYear()}-${pad(l.getMonth() + 1)}`;
}

/** The last n Israel days ending with today, oldest first. Every calendar day appears exactly once (a 23 or 25 hour day too). */
export function lastDayKeys(now: Date, n: number): string[] {
  const keys: string[] = [];
  for (let i = n - 1; i >= 0; i--) keys.push(dayKey(israelDayStart(now, -i)));
  return keys;
}

/** The last n Israel months ending with this one, oldest first. */
export function lastMonthKeys(now: Date, n: number): string[] {
  const keys: string[] = [];
  for (let i = n - 1; i >= 0; i--) keys.push(monthKey(israelMonthStart(now, i)));
  return keys;
}
