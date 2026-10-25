import { NextRequest, NextResponse } from "next/server";
import { requireSuperadmin } from "@/lib/superadmin/auth";
import { JSON_NO_STORE } from "@/lib/superadmin/config";
import { getMetrics } from "@/lib/superadmin/get-metrics";

export const dynamic = "force-dynamic";

/** The dashboard numbers: counts per business and per day only, read-only, for the signed-in superadmin. */
export async function GET(request: NextRequest) {
  const auth = requireSuperadmin(request);
  if (auth.error) return auth.error;
  try {
    return NextResponse.json(await getMetrics(), { headers: JSON_NO_STORE });
  } catch (err) {
    // e.g. the migration has not been run yet. The reason stays out of the answer (and of the log, except its kind).
    console.error("superadmin metrics failed:", err instanceof Error ? err.name : "unknown");
    return NextResponse.json({ error: "unavailable" }, { status: 503, headers: JSON_NO_STORE });
  }
}
