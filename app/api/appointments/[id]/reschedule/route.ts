import { NextRequest, NextResponse, after } from "next/server";
import { addMinutes, parseISO } from "date-fns";
import {
  getAppointmentById,
  getAppointments,
  getBusinessById,
  getServices,
  openWaitlistForSlot,
  rescheduleAppointment,
} from "@/lib/db";
import { getValidSession, requireRole, ANY_ROLE } from "@/lib/access";
import { clientIp, rateLimit, tooMany } from "@/lib/rateLimit";
import { customerChangePolicy } from "@/lib/booking/policy";
import { generateAvailableSlots, israelDateString } from "@/lib/booking/slotGenerator";
import { notifyBusiness } from "@/lib/push";
import { formatHebrewDate, formatTime } from "@/lib/utils";

export const dynamic = "force-dynamic";

/**
 * Move an appointment to another time. Customers use the capability link from their
 * confirmation (cutoff hours enforced, only offered slots); the team may move anything.
 */
export async function POST(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    if (!rateLimit(`appt-move:${clientIp(request)}`, 20, 10 * 60 * 1000)) return tooMany();

    const body = await request.json();
    const newStart = typeof body?.start_time === "string" ? parseISO(body.start_time) : null;
    if (!newStart || Number.isNaN(newStart.getTime())) {
      return NextResponse.json({ error: "זמן לא תקין" }, { status: 400 });
    }

    const appt = await getAppointmentById(id);
    if (!appt || appt.status !== "confirmed" || !appt.service_id) {
      return NextResponse.json({ error: "התור לא נמצא או שאינו פעיל" }, { status: 404 });
    }
    const business = await getBusinessById(appt.business_id);
    if (!business) return NextResponse.json({ error: "עסק לא נמצא" }, { status: 404 });

    const teamId = (await getValidSession(request))?.businessId ?? null;
    const isTeam = teamId !== null && teamId === appt.business_id;
    if (isTeam) {
      const auth = await requireRole(request, ANY_ROLE);
      if (auth.error) return auth.error;
    } else {
      const policy = customerChangePolicy(business, appt.start_time);
      if (!policy.allowed) {
        return NextResponse.json(
          { error: policy.reason, blocked: true, owner_phone: business.owner_phone },
          { status: 403 }
        );
      }
    }

    const services = await getServices(appt.business_id);
    const service = services.find((s) => s.id === appt.service_id);
    if (!service) return NextResponse.json({ error: "שירות לא נמצא" }, { status: 404 });

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
        return NextResponse.json({ error: "השעה שנבחרה אינה זמינה. אנא בחר מועד אחר." }, { status: 409 });
      }
    }

    const newEnd = addMinutes(newStart, service.duration_minutes + (service.buffer_minutes || 0));
    const clash = others.some(
      (a) =>
        a.status === "confirmed" &&
        new Date(a.start_time) < newEnd &&
        new Date(a.end_time) > newStart
    );
    if (clash) {
      return NextResponse.json({ error: "השעה שנבחרה כבר נתפסה. אנא בחר מועד אחר." }, { status: 409 });
    }

    const oldStart = appt.start_time;
    const moved = await rescheduleAppointment(appt.id, newStart.toISOString(), newEnd.toISOString());
    if (!moved) return NextResponse.json({ error: "התור לא נמצא" }, { status: 404 });

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

    return NextResponse.json({
      success: true,
      appointment: { id: moved.id, start_time: moved.start_time, end_time: moved.end_time, status: moved.status },
    });
  } catch (error: unknown) {
    if ((error as { code?: string })?.code === "23P01") {
      return NextResponse.json({ error: "השעה שנבחרה כבר נתפסה. אנא בחר מועד אחר." }, { status: 409 });
    }
    console.error("Error rescheduling:", error);
    return NextResponse.json({ error: "שגיאה בשינוי התור" }, { status: 500 });
  }
}
