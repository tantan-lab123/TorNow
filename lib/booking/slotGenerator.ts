import { Business, Service, Appointment, TimeSlot, DayOfWeek } from "@/lib/types";
import { format, addMinutes, addDays, isBefore, isAfter } from "date-fns";
import { TZDate } from "@date-fns/tz";

// All business hours are wall-clock times in Israel. The server runs in UTC, so every
// calculation below is done in this zone and slots are returned as true UTC instants.
export const BUSINESS_TZ = "Asia/Jerusalem";

const DAY_NAMES_MAP: Record<number, DayOfWeek> = {
  0: "sunday",
  1: "monday",
  2: "tuesday",
  3: "wednesday",
  4: "thursday",
  5: "friday",
  6: "saturday",
};

/** "YYYY-MM-DD" of an instant as seen on the wall clock in Israel. */
export function israelDateString(instant: Date | string): string {
  return format(new TZDate(new Date(instant), BUSINESS_TZ), "yyyy-MM-dd");
}

/** Wall-clock "YYYY-MM-DD" + "HH:mm" in Israel -> TZDate (a real instant). */
function israelTime(dateStr: string, hhmm: string): TZDate {
  const [y, m, d] = dateStr.split("-").map(Number);
  const [hh, mm] = hhmm.split(":").map(Number);
  return new TZDate(y, m - 1, d, hh, mm, 0, 0, BUSINESS_TZ);
}

/**
 * How close and how far ahead customers may book, from the business settings.
 * The defaults match what the settings screen shows when nothing was saved.
 */
export function bookingWindow(business: Pick<Business, "settings">, now: Date = new Date()) {
  const minNoticeMinutes = Math.round((business.settings?.min_notice_hours ?? 1) * 60);
  const maxFutureDays = business.settings?.max_future_days ?? 60;
  return {
    minNoticeMinutes,
    maxFutureDays,
    earliest: addMinutes(now, minNoticeMinutes),
    latest: addDays(now, maxFutureDays),
  };
}

export interface SlotGeneratorOptions {
  business: Business;
  service: Service;
  selectedDate: Date; // only its calendar day (yyyy-MM-dd) is used
  existingAppointments: Appointment[];
  stepMinutes?: number; // default 15 or 30 mins
}

export function generateAvailableSlots({
  business,
  service,
  selectedDate,
  existingAppointments,
  stepMinutes = 15,
}: SlotGeneratorOptions): {
  slots: TimeSlot[];
  isOpenToday: boolean;
  message?: string;
} {
  const dateStr = format(selectedDate, "yyyy-MM-dd");
  const now = new TZDate(Date.now(), BUSINESS_TZ);
  const todayStr = format(now, "yyyy-MM-dd");
  // Customers only see times they can actually book: at least 10 minutes and the
  // business "minimum notice" from now, and no further than its booking window.
  const limits = bookingWindow(business, now);
  const earliest = addMinutes(now, Math.max(10, limits.minNoticeMinutes));

  // Check if date is in the past (Israel calendar)
  if (dateStr < todayStr) {
    return {
      slots: [],
      isOpenToday: false,
      message: "תאריך שעבר",
    };
  }

  // Check specific date override (holidays, vacation closures, custom hours)
  const dateOverride = business.date_overrides?.find((o) => o.date === dateStr);
  if (dateOverride) {
    if (dateOverride.is_closed) {
      return {
        slots: [],
        isOpenToday: false,
        message: `בית העסק סגור בתאריך זה (${dateOverride.reason || "חג / חופשה"})`,
      };
    }
  }

  const dayIndex = israelTime(dateStr, "12:00").getDay();
  const dayName = DAY_NAMES_MAP[dayIndex];
  const dayConfig = business.working_hours[dayName];

  if (!dayConfig || !dayConfig.active) {
    return {
      slots: [],
      isOpenToday: false,
      message: "בית העסק סגור ביום זה",
    };
  }

  // Parse open & close times on selected date (allow override for special day hours)
  const effectiveOpen = dateOverride?.custom_open || dayConfig.open;
  const effectiveClose = dateOverride?.custom_close || dayConfig.close;

  const openTime = israelTime(dateStr, effectiveOpen);
  const closeTime = israelTime(dateStr, effectiveClose);

  if (isAfter(openTime, limits.latest)) {
    return {
      slots: [],
      isOpenToday: false,
      message: `אפשר לקבוע תור עד ${limits.maxFutureDays} ימים קדימה`,
    };
  }

  const totalRequiredMinutes = service.duration_minutes + (service.buffer_minutes || 0);

  // Resolution interval (e.g. 15, 20, 30, 45, 60 minutes)
  const effectiveStep = business.slot_interval_minutes || stepMinutes || 15;

  // Parse lunch break if configured and active
  const lunchBreak =
    dayConfig.lunch_break?.active &&
    dayConfig.lunch_break.start &&
    dayConfig.lunch_break.end
      ? {
          start: israelTime(dateStr, dayConfig.lunch_break.start),
          end: israelTime(dateStr, dayConfig.lunch_break.end),
        }
      : null;

  // Active confirmed appointments
  const activeAppointments = existingAppointments.filter((app) => app.status === "confirmed");

  const slots: TimeSlot[] = [];
  let currentPointer = openTime;

  while (isBefore(currentPointer, closeTime)) {
    const slotEnd = addMinutes(currentPointer, totalRequiredMinutes);

    // If slot extends beyond closing time, break
    if (isAfter(slotEnd, closeTime)) {
      break;
    }

    // Too soon (past, or inside the minimum notice) or beyond the booking window
    const outsideWindow = isBefore(currentPointer, earliest) || isAfter(currentPointer, limits.latest);

    // Check lunch break collision
    const overlapsLunch = lunchBreak
      ? isBefore(currentPointer, lunchBreak.end) && isAfter(slotEnd, lunchBreak.start)
      : false;

    // Collision check against existing appointments
    const hasCollision = activeAppointments.some((app) => {
      const appStart = new Date(app.start_time);
      const appEnd = new Date(app.end_time);
      return isBefore(appStart, slotEnd) && isAfter(appEnd, currentPointer);
    });

    if (!outsideWindow && !hasCollision && !overlapsLunch) {
      const hours = currentPointer.getHours();
      let period: "morning" | "afternoon" | "evening" = "morning";
      if (hours >= 12 && hours < 17) {
        period = "afternoon";
      } else if (hours >= 17) {
        period = "evening";
      }

      slots.push({
        startTime: new Date(currentPointer.getTime()).toISOString(),
        endTime: new Date(slotEnd.getTime()).toISOString(),
        formattedTime: format(currentPointer, "HH:mm"),
        period,
        available: true,
      });
    }

    // Advance by effectiveStep (e.g. 15, 20, 30, 45, 60 mins)
    currentPointer = addMinutes(currentPointer, effectiveStep);
  }

  return {
    slots,
    isOpenToday: true,
    message: slots.length === 0 ? "אין תורים פנויים ביום זה" : undefined,
  };
}
