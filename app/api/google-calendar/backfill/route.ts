import { NextRequest, NextResponse } from "next/server";
import { requireRole, OWNER_ONLY } from "@/lib/access";
import { rateLimit, tooMany } from "@/lib/rateLimit";
import { backfillCalendar, getCalendarStatus } from "@/lib/google-sync";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Owner only: syncs the existing FUTURE appointments after the first connection. */
export async function POST(request: NextRequest) {
  try {
    const auth = await requireRole(request, OWNER_ONLY);
    if (auth.error) return auth.error;
    const businessId = auth.session.businessId;
    if (!rateLimit(`gcal-backfill:${businessId}`, 5, 60 * 60 * 1000)) return tooMany();

    const status = await getCalendarStatus(businessId);
    if (!status.connected) {
      return NextResponse.json({ error: "היומן אינו מחובר" }, { status: 409 });
    }
    const result = await backfillCalendar(businessId);
    return NextResponse.json(
      { success: true, ...result, ...(await getCalendarStatus(businessId)) },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch {
    console.error("google calendar backfill failed");
    return NextResponse.json({ error: "לא הצלחנו לסנכרן את התורים הקיימים. נסו שוב." }, { status: 500 });
  }
}
