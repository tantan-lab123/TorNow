import { NextRequest, NextResponse } from "next/server";
import { unauthorized, verifyBearer } from "@/lib/auth";
import { planReminders, runDueSms } from "@/lib/sms/service";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Called every few minutes by an external scheduler (cron-job.org) with
// "Authorization: Bearer <CRON_SECRET>". First queues the reminders that have become due, then sends
// and retries the SMS that are due.
export async function POST(request: NextRequest) {
  if (!verifyBearer(request, process.env.CRON_SECRET)) return unauthorized();

  // The planner failing (e.g. the reminders migration has not been run yet) must never stop the
  // confirmations and retries below.
  let reminders: Awaited<ReturnType<typeof planReminders>> | { error: true } = { error: true };
  try {
    reminders = await planReminders();
  } catch (err) {
    console.error("sms reminder planning failed:", err instanceof Error ? err.name : "unknown");
  }

  try {
    const result = await runDueSms(10);
    return NextResponse.json({ success: true, reminders, ...result }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    // e.g. the migration is not applied yet: report, do not crash the scheduler
    console.error("sms outbox job failed");
    return NextResponse.json({ success: false }, { status: 500 });
  }
}
