import { after } from "next/server";
import { addMinutes, parseISO } from "date-fns";
import {
  getAppointments,
  getServices,
  openWaitlistForSlot,
  rescheduleAppointment,
  updateAppointmentStatus,
} from "@/lib/db";
import { extendSmsManageTokens } from "@/lib/db/sms";
import { customerChangePolicy } from "@/lib/booking/policy";
import { generateAvailableSlots, israelDateString } from "@/lib/booking/slotGenerator";
import { syncAppointment } from "@/lib/google-sync";
import { notifyBusiness } from "@/lib/push";
import { formatHebrewDate, formatTime } from "@/lib/utils";
import type { Appointment, AppointmentStatus, Business } from "@/lib/types";

/**
 * Changes to an existing appointment, in ONE place: used by the owner's screens, the
 * appointment link (/cancel/[id]) and the SMS manage link (/t/[token]). Whoever calls it,
 * the Google Calendar sync, the waiting list and the owner's push all run the same way.
 */

export type ChangeFailure = {
  ok: false;
  status: number;
  error: string;
  blocked?: boolean;
  owner_phone?: string;
};

/** Customer-side rule: not within the business's cancellation cutoff. */
export function customerBlock(
  business: Pick<Business, "settings" | "owner_phone"> | null | undefined,
  appt: Pick<Appointment, "start_time">
): ChangeFailure | null {
  const policy = customerChangePolicy(business ?? undefined, appt.start_time);
  if (policy.allowed) return null;
  return {
    ok: false,
    status: 403,
    error: policy.reason ?? "לא ניתן לשנות את התור",
    blocked: true,
    owner_phone: business?.owner_phone,
  };
}

/** Writes a new status, then (after the response) syncs the calendar and frees the slot. */
export async function applyStatusChange(
  existing: Appointment,
  status: AppointmentStatus,
  isTeam: boolean
): Promise<Appointment | null> {
  const updated = await updateAppointmentStatus(existing.id, status);
  if (!updated) return null;

  // Owner's Google Calendar: cancelled -> removed, restored -> created again
  after(() => syncAppointment(updated.id));

  // A freed slot: flag everyone waiting for that day, and tell the owner.
  if (status === "cancelled" && existing.status === "confirmed" && existing.service_id) {
    after(async () => {
      try {
        const n = await openWaitlistForSlot(
          existing.business_id,
          israelDateString(existing.start_time),
          existing.start_time
        );
        await notifyBusiness(existing.business_id, {
          title: isTeam ? "תור בוטל" : "לקוח ביטל תור",
          body:
            `${existing.client?.first_name ?? "לקוח"} · ${formatHebrewDate(existing.start_time)} ${formatTime(existing.start_time)}` +
            (n > 0 ? ` · ${n} ממתינים ברשימת ההמתנה` : ""),
          url: "/admin",
        });
      } catch (e) {
        console.error("post-cancel tasks failed:", e);
      }
    });
  }
  return updated;
}

/**
 * Moves a confirmed appointment. Customers (isTeam = false) get the cancellation cutoff and
 * only the slots the business offers; the team may move anything that does not collide.
 */
export async function moveAppointment(
  appt: Appointment,
  business: Business,
  newStart: Date,
  isTeam: boolean
): Promise<{ ok: true; appointment: Appointment } | ChangeFailure> {
  if (!isTeam) {
    const blocked = customerBlock(business, appt);
    if (blocked) return blocked;
  }

  const services = await getServices(appt.business_id);
  const service = services.find((s) => s.id === appt.service_id);
  if (!service) return { ok: false, status: 404, error: "שירות לא נמצא" };

  // The slot must be offered (ignoring this appointment itself, so a small shift is possible).
  // Only the days around the new time matter for that and for the clash check.
  const DAY = 24 * 3600 * 1000;
  const others = (
    await getAppointments(
      appt.business_id,
      new Date(newStart.getTime() - 2 * DAY).toISOString(),
      new Date(newStart.getTime() + 3 * DAY).toISOString()
    )
  ).filter((a) => a.id !== appt.id);
  if (!isTeam) {
    const offered = generateAvailableSlots({
      business,
      service,
      selectedDate: parseISO(israelDateString(newStart)),
      existingAppointments: others,
      stepMinutes: business.slot_interval_minutes || 15,
    });
    if (!offered.slots.some((sl) => new Date(sl.startTime).getTime() === newStart.getTime())) {
      return { ok: false, status: 409, error: "השעה שנבחרה אינה זמינה. אנא בחר מועד אחר." };
    }
  }

  const newEnd = addMinutes(newStart, service.duration_minutes + (service.buffer_minutes || 0));
  const clash = others.some(
    (a) => a.status === "confirmed" && new Date(a.start_time) < newEnd && new Date(a.end_time) > newStart
  );
  if (clash) return { ok: false, status: 409, error: "השעה שנבחרה כבר נתפסה. אנא בחר מועד אחר." };

  const oldStart = appt.start_time;
  let moved: Appointment | null;
  try {
    moved = await rescheduleAppointment(appt.id, newStart.toISOString(), newEnd.toISOString());
  } catch (error) {
    // 23P01 = exclusion_violation: someone took the slot a moment earlier (the DB is the hard guarantee)
    if ((error as { code?: string })?.code === "23P01") {
      return { ok: false, status: 409, error: "השעה שנבחרה כבר נתפסה. אנא בחר מועד אחר." };
    }
    throw error;
  }
  if (!moved) return { ok: false, status: 404, error: "התור לא נמצא" };

  // The SMS manage link stays valid until the end of the new time. Best effort.
  try {
    await extendSmsManageTokens(moved.id, moved.end_time);
  } catch (e) {
    console.error("sms token extension failed:", e instanceof Error ? e.name : "unknown");
  }

  // Owner's Google Calendar: the event moves with the appointment
  after(() => syncAppointment(moved.id));

  after(async () => {
    try {
      await openWaitlistForSlot(appt.business_id, israelDateString(oldStart), oldStart);
      await notifyBusiness(appt.business_id, {
        title: isTeam ? "תור הועבר" : "לקוח שינה מועד תור",
        body: `${appt.client?.first_name ?? "לקוח"} · עבר ל-${formatHebrewDate(moved.start_time)} ${formatTime(moved.start_time)}`,
        url: "/admin",
      });
    } catch (e) {
      console.error("post-reschedule tasks failed:", e);
    }
  });

  return { ok: true, appointment: moved };
}
