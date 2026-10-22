import { NextRequest, NextResponse } from "next/server";
import { requireRole, MANAGEMENT } from "@/lib/access";
import { getCalendarStatus } from "@/lib/google-sync";

export const dynamic = "force-dynamic";

/** Owner / manager: whether the Google calendar is connected, as the browser may see it (no tokens). */
export async function GET(request: NextRequest) {
  const auth = await requireRole(request, MANAGEMENT);
  if (auth.error) return auth.error;
  const status = await getCalendarStatus(auth.session.businessId);
  return NextResponse.json(status, { headers: { "Cache-Control": "no-store" } });
}
