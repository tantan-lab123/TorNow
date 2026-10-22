import { NextRequest, NextResponse } from "next/server";
import { requireRole, MANAGEMENT } from "@/lib/access";
import { rateLimit, tooMany } from "@/lib/rateLimit";
import { getCalendarStatus, retryCalendar } from "@/lib/google-sync";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Owner / manager: the "retry" button for appointments that failed to sync. */
export async function POST(request: NextRequest) {
  try {
    const auth = await requireRole(request, MANAGEMENT);
    if (auth.error) return auth.error;
    const businessId = auth.session.businessId;
    if (!rateLimit(`gcal-retry:${businessId}`, 20, 60 * 60 * 1000)) return tooMany();

    const result = await retryCalendar(businessId);
    return NextResponse.json(
      { success: true, ...result, ...(await getCalendarStatus(businessId)) },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch {
    console.error("google calendar retry failed");
    return NextResponse.json({ error: "לא הצלחנו לנסות שוב. נסו בעוד רגע." }, { status: 500 });
  }
}
