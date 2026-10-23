import { NextRequest, NextResponse } from "next/server";
import { getBusinessById } from "@/lib/db";
import { applyStatusChange, customerBlock } from "@/lib/booking/changes";
import { clientIp, rateLimit, tooMany } from "@/lib/rateLimit";
import { resolveManageToken } from "@/lib/sms/manage";

export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" };

export async function POST(request: NextRequest, ctx: { params: Promise<{ token: string }> }) {
  try {
    const { token } = await ctx.params;
    if (!rateLimit(`manage-act:${clientIp(request)}`, 20, 10 * 60 * 1000)) return tooMany();

    const appt = await resolveManageToken(token);
    if (!appt) return NextResponse.json({ error: "התור לא נמצא" }, { status: 404, headers: NO_STORE });

    // already cancelled: same answer, nothing to do twice
    if (appt.status === "cancelled") {
      return NextResponse.json({ success: true, appointment: { status: "cancelled" } }, { headers: NO_STORE });
    }

    // the business's cancellation cutoff, exactly as for the appointment link
    const business = await getBusinessById(appt.business_id);
    const blocked = customerBlock(business, appt);
    if (blocked) {
      const { ok: _ok, status, ...payload } = blocked;
      return NextResponse.json(payload, { status, headers: NO_STORE });
    }

    const updated = await applyStatusChange(appt, "cancelled", false);
    if (!updated) return NextResponse.json({ error: "התור לא נמצא" }, { status: 404, headers: NO_STORE });
    return NextResponse.json({ success: true, appointment: { status: updated.status } }, { headers: NO_STORE });
  } catch (error) {
    console.error("Error cancelling via sms link:", error instanceof Error ? error.name : "unknown");
    return NextResponse.json({ error: "שגיאה בביטול התור" }, { status: 500, headers: NO_STORE });
  }
}
