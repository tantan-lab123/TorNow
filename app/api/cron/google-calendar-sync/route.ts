import { NextRequest, NextResponse } from "next/server";
import { unauthorized, verifyBearer } from "@/lib/auth";
import { runDueCalendarSyncs } from "@/lib/google-sync";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Called every few minutes by an external scheduler (cron-job.org) with
// "Authorization: Bearer <CRON_SECRET>". Retries appointments whose Google sync failed.
async function handle(request: NextRequest) {
  if (!verifyBearer(request, process.env.CRON_SECRET)) return unauthorized();
  try {
    const result = await runDueCalendarSyncs(25);
    return NextResponse.json({ success: true, ...result }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    // e.g. the migration is not applied yet: report, do not crash the scheduler
    console.error("google calendar retry job failed");
    return NextResponse.json({ success: false }, { status: 500 });
  }
}

export const GET = handle;
export const POST = handle;
