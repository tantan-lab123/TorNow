import { NextRequest, NextResponse } from "next/server";
import { requireRole, MANAGEMENT } from "@/lib/access";
import { getSmsUsage } from "@/lib/db/sms";

export const dynamic = "force-dynamic";

/**
 * This month's confirmation SMS of the signed-in business (Israel calendar month).
 * Owner and managers only; always the session's own business, never one from the request.
 */
export async function GET(request: NextRequest) {
  const auth = await requireRole(request, MANAGEMENT);
  if (auth.error) return auth.error;
  try {
    const usage = await getSmsUsage(auth.session.businessId);
    return NextResponse.json(usage, { headers: { "Cache-Control": "no-store" } });
  } catch {
    // e.g. the usage migration has not been run yet: the screen shows a dash
    return NextResponse.json({ error: "unavailable" }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
