import { NextRequest, NextResponse } from "next/server";
import { unauthorized, verifyBearer } from "@/lib/auth";
import { getValidSession } from "@/lib/access";

export const dynamic = "force-dynamic";

/**
 * RETIRED. This route used to build a reminder text, send nothing, and mark appointments as
 * "reminder_sent". Reminders are now real SMS, planned and sent by POST /api/cron/sms-outbox
 * (see lib/sms/reminders.ts). The route stays because a scheduler may still call it: it answers
 * "nothing to do" and touches no data (appointments.reminder_sent is left alone).
 */
async function handleReminders(request: NextRequest) {
  const isCron = verifyBearer(request, process.env.CRON_SECRET);
  const signedIn = isCron ? true : !!(await getValidSession(request));
  if (!signedIn) return unauthorized();
  return NextResponse.json(
    { success: true, deprecated: true, processed_count: 0 },
    { headers: { "Cache-Control": "no-store" } }
  );
}

export async function GET(request: NextRequest) {
  return handleReminders(request);
}

export async function POST(request: NextRequest) {
  return handleReminders(request);
}
