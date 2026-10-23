import { NextRequest, NextResponse } from "next/server";
import { parseISO } from "date-fns";
import { getAppointmentById, getBusinessById } from "@/lib/db";
import { getValidSession, requireRole, ANY_ROLE } from "@/lib/access";
import { clientIp, rateLimit, tooMany } from "@/lib/rateLimit";
import { moveAppointment } from "@/lib/booking/changes";

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
    }

    const result = await moveAppointment(appt, business, newStart, isTeam);
    if (!result.ok) {
      const { ok: _ok, status, ...payload } = result;
      return NextResponse.json(payload, { status });
    }
    const moved = result.appointment;
    return NextResponse.json({
      success: true,
      appointment: { id: moved.id, start_time: moved.start_time, end_time: moved.end_time, status: moved.status },
    });
  } catch (error: unknown) {
    console.error("Error rescheduling:", error);
    return NextResponse.json({ error: "שגיאה בשינוי התור" }, { status: 500 });
  }
}
