import { NextRequest, NextResponse } from "next/server";
import { parseISO } from "date-fns";
import { getBusinessById } from "@/lib/db";
import { moveAppointment } from "@/lib/booking/changes";
import { clientIp, rateLimit, tooMany } from "@/lib/rateLimit";
import { resolveManageToken } from "@/lib/sms/manage";

export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" };

export async function POST(request: NextRequest, ctx: { params: Promise<{ token: string }> }) {
  try {
    const { token } = await ctx.params;
    if (!rateLimit(`manage-act:${clientIp(request)}`, 20, 10 * 60 * 1000)) return tooMany();

    const body = await request.json().catch(() => null);
    const newStart = typeof body?.start_time === "string" ? parseISO(body.start_time) : null;

    const appt = await resolveManageToken(token);
    if (!appt || appt.status !== "confirmed" || !appt.service_id) {
      return NextResponse.json({ error: "התור לא נמצא או שאינו פעיל" }, { status: 404, headers: NO_STORE });
    }
    if (!newStart || Number.isNaN(newStart.getTime())) {
      return NextResponse.json({ error: "זמן לא תקין" }, { status: 400, headers: NO_STORE });
    }
    const business = await getBusinessById(appt.business_id);
    if (!business) return NextResponse.json({ error: "התור לא נמצא" }, { status: 404, headers: NO_STORE });

    // Same function the owner's screens use: cutoff, offered slots, collisions, calendar sync.
    const result = await moveAppointment(appt, business, newStart, false);
    if (!result.ok) {
      const { ok: _ok, status, ...payload } = result;
      return NextResponse.json(payload, { status, headers: NO_STORE });
    }
    const moved = result.appointment;
    return NextResponse.json(
      { success: true, appointment: { start_time: moved.start_time, end_time: moved.end_time, status: moved.status } },
      { headers: NO_STORE }
    );
  } catch (error) {
    console.error("Error rescheduling via sms link:", error instanceof Error ? error.name : "unknown");
    return NextResponse.json({ error: "שגיאה בשינוי התור" }, { status: 500, headers: NO_STORE });
  }
}
