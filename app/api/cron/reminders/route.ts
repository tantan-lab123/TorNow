import { NextRequest, NextResponse } from "next/server";
import { getPendingReminders, markReminderSent } from "@/lib/db";
import { formatHebrewDate, formatTime } from "@/lib/utils";
import { unauthorized, verifyBearer } from "@/lib/auth";
import { getValidSession } from "@/lib/access";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  return handleReminders(request);
}

export async function POST(request: NextRequest) {
  return handleReminders(request);
}

async function handleReminders(request: NextRequest) {
  // Scheduler: Authorization: Bearer <CRON_SECRET> (secret is never accepted in the URL
  // and there is no built-in default). Vercel Cron sends this header automatically.
  // A logged-in owner may run the check for their OWN business only.
  const isCron = verifyBearer(request, process.env.CRON_SECRET);
  const ownerId = isCron ? null : ((await getValidSession(request))?.businessId ?? null);
  if (!isCron && !ownerId) return unauthorized();

  try {
    const all = await getPendingReminders(24, 25);
    const pendingAppointments = ownerId ? all.filter((a) => a.business_id === ownerId) : all;

    let processed = 0;
    const results = [];

    for (const app of pendingAppointments) {
      const client = app.client;
      if (!client || !client.phone) continue;

      const dateText = formatHebrewDate(app.start_time);
      const timeText = formatTime(app.start_time);
      const businessName = app.business?.name || "בית העסק";
      const serviceName = app.service?.name || "טיפול";

      const baseUrl =
        process.env.NEXT_PUBLIC_APP_URL ||
        (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "https://schedule.app");

      const message =
        `היי ${client.first_name}! 🌟\n` +
        `תזכורת לתור שלך ל${serviceName} ב${businessName}.\n` +
        `🗓 מועד: ${dateText} בשעה ${timeText}.\n` +
        `לביטול או שינוי: ${baseUrl}/cancel/${app.id}\n` +
        `נשמח לראותך!`;

      // TODO: hand `message` to the real WhatsApp/SMS gateway. Nothing personal is logged here.
      await markReminderSent(app.id);
      processed += 1;

      // Only the owner-triggered manual run echoes details back (their own clients).
      if (ownerId) {
        results.push({
          appointment_id: app.id,
          phone: client.phone,
          client_name: `${client.first_name} ${client.last_name}`,
          service: serviceName,
          start_time: app.start_time,
          message,
        });
      }
    }

    return NextResponse.json({
      success: true,
      timestamp: new Date().toISOString(),
      processed_count: processed,
      ...(ownerId ? { reminders_sent: results } : {}),
    });
  } catch (error) {
    console.error("Error running reminder cron:", error);
    return NextResponse.json({ error: "Internal server error running reminder cron" }, { status: 500 });
  }
}
