import { NextRequest, NextResponse } from "next/server";
import { unauthorized, verifyBearer } from "@/lib/auth";
import { runDueSms } from "@/lib/sms/service";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Called every few minutes by an external scheduler (cron-job.org) with
// "Authorization: Bearer <CRON_SECRET>". Sends and retries the SMS that are due.
export async function POST(request: NextRequest) {
  if (!verifyBearer(request, process.env.CRON_SECRET)) return unauthorized();
  try {
    const result = await runDueSms(10);
    return NextResponse.json({ success: true, ...result }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    // e.g. the migration is not applied yet: report, do not crash the scheduler
    console.error("sms outbox job failed");
    return NextResponse.json({ success: false }, { status: 500 });
  }
}
