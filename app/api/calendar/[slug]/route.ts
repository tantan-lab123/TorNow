import { NextRequest, NextResponse } from "next/server";
import { getBusinessBySlug, getAppointments, getStaffByBusiness } from "@/lib/db";
import { verifyCalendarToken } from "@/lib/auth";
import { clientIp, rateLimit, tooMany } from "@/lib/rateLimit";
import { Appointment } from "@/lib/types";

export const dynamic = "force-dynamic";

function toIcsDate(isoString: string): string {
  return new Date(isoString).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

// RFC 5545 text escaping; also strips CR/LF so user input cannot inject ICS properties.
function escapeIcsText(text: string): string {
  return text
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r?\n/g, "\\n")
    .replace(/[\r\x00-\x08\x0b-\x1f]/g, "");
}

// Private subscription feed: requires the owner's secret ?t= token, or a manager's own one
// (shown only inside the logged-in admin). Contains client names and phones.
async function feedTokenValid(businessId: string, version: number | undefined, token: string | null) {
  if (!token) return false;
  if (verifyCalendarToken(token, businessId, version)) return true;
  // A manager's link works only while they are an active manager of this business.
  const staff = await getStaffByBusiness(businessId);
  return staff.some(
    (s) => s.active && s.role === "manager" && verifyCalendarToken(token, businessId, version, s.id)
  );
}

export async function GET(request: NextRequest, ctx: { params: Promise<{ slug: string }> }) {
  try {
    if (!rateLimit(`ics:${clientIp(request)}`, 60, 10 * 60 * 1000)) return tooMany();

    const { slug } = await ctx.params;
    const business = await getBusinessBySlug(slug);

    // Same response for "no such business" and "bad token": no slug enumeration.
    if (
      !business ||
      !(await feedTokenValid(business.id, business.calendar_version, request.nextUrl.searchParams.get("t")))
    ) {
      return new NextResponse("Not found", { status: 404 });
    }

    // The feed carries the last month and everything ahead, not the whole history
    const since = new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString();
    const appointments = await getAppointments(business.id, since);
    const confirmedApps = appointments.filter((a: Appointment) => a.status === "confirmed");
    const nowIcs = toIcsDate(new Date().toISOString());

    const icsContent = [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "PRODID:-//Torli//Appointment Scheduler//HE",
      "CALSCALE:GREGORIAN",
      "METHOD:PUBLISH",
      `X-WR-CALNAME:${escapeIcsText(business.name)} - תורים`,
      "X-WR-TIMEZONE:Asia/Jerusalem",
      "REFRESH-INTERVAL;VALUE=DURATION:PT15M",
      "X-PUBLISHED-TTL:PT15M",
    ];

    for (const app of confirmedApps) {
      const clientName = app.client ? `${app.client.first_name} ${app.client.last_name}` : "לקוח";
      const serviceName = app.service?.name || "טיפול";
      const price = Number(app.service?.price) || 0;
      const phone = app.client?.phone || "";

      const description = [
        `שם הלקוח: ${clientName}`,
        `טלפון: ${phone}`,
        `שירות: ${serviceName}`,
        `מחיר: ₪${price}`,
        "נקבע דרך מערכת Torli",
      ]
        .map(escapeIcsText)
        .join("\\n");

      icsContent.push(
        "BEGIN:VEVENT",
        `UID:${app.id}@torli.app`,
        `DTSTAMP:${nowIcs}`,
        `DTSTART:${toIcsDate(app.start_time)}`,
        `DTEND:${toIcsDate(app.end_time)}`,
        `SUMMARY:${escapeIcsText(`${serviceName} - ${clientName}`)}`,
        `DESCRIPTION:${description}`,
        `LOCATION:${escapeIcsText(business.name)}`,
        "STATUS:CONFIRMED",
        "END:VEVENT"
      );
    }

    icsContent.push("END:VCALENDAR");

    return new NextResponse(icsContent.join("\r\n"), {
      status: 200,
      headers: {
        "Content-Type": "text/calendar; charset=utf-8",
        "Content-Disposition": `inline; filename="calendar.ics"`,
        "Cache-Control": "private, no-store",
        "X-Robots-Tag": "noindex",
      },
    });
  } catch (error) {
    console.error("Calendar feed error:", error);
    return new NextResponse("Internal Server Error", { status: 500 });
  }
}
