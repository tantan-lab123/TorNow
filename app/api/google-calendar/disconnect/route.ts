import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireRole, OWNER_ONLY } from "@/lib/access";
import { disconnectCalendar, getCalendarStatus } from "@/lib/google-sync";

export const dynamic = "force-dynamic";

const schema = z.object({ delete_calendar: z.boolean().default(false) });

/** Owner only: revokes the token at Google, removes the connection, optionally deletes the TorNow calendar. */
export async function POST(request: NextRequest) {
  try {
    const auth = await requireRole(request, OWNER_ONLY);
    if (auth.error) return auth.error;

    const body = await request.json().catch(() => ({}));
    const parsed = schema.safeParse(body);
    const deleteCalendar = parsed.success ? parsed.data.delete_calendar : false;

    const result = await disconnectCalendar(auth.session.businessId, { deleteCalendar });
    return NextResponse.json(
      { success: true, ...result, ...(await getCalendarStatus(auth.session.businessId)) },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch {
    console.error("google calendar disconnect failed");
    return NextResponse.json({ error: "לא הצלחנו לנתק את היומן. נסו שוב." }, { status: 500 });
  }
}
