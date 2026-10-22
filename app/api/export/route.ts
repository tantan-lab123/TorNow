import { NextRequest, NextResponse } from "next/server";
import {
  getAllAppointmentsForExport,
  getBusinessById,
  getClients,
  getServices,
  getStaffByBusiness,
  getWaitlist,
} from "@/lib/db";
import { requireRole, MANAGEMENT } from "@/lib/access";
import { toPublicBusiness } from "@/lib/auth";
import { rateLimit, tooMany } from "@/lib/rateLimit";
import { formatHebrewDate, formatTime } from "@/lib/utils";

export const dynamic = "force-dynamic";

// Spreadsheet formula injection guard: a cell starting with = + - @ would execute in Excel.
function csvCell(v: unknown): string {
  let s = v === null || v === undefined ? "" : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return `"${s.replace(/"/g, '""')}"`;
}

function csv(rows: unknown[][]): string {
  // UTF-8 BOM so Excel shows Hebrew correctly
  return "﻿" + rows.map((r) => r.map(csvCell).join(",")).join("\r\n");
}

/** Owner/manager: download a full backup (?format=json) or spreadsheets (?format=appointments|clients). */
export async function GET(request: NextRequest) {
  const auth = await requireRole(request, MANAGEMENT);
  if (auth.error) return auth.error;
  const businessId = auth.session.businessId;
  if (!rateLimit(`export:${businessId}`, 20, 60 * 60 * 1000)) return tooMany();

  const format = request.nextUrl.searchParams.get("format") || "json";
  const stamp = new Date().toISOString().slice(0, 10);
  const business = await getBusinessById(businessId);
  if (!business) return NextResponse.json({ error: "עסק לא נמצא" }, { status: 404 });

  if (format === "appointments") {
    const appts = await getAllAppointmentsForExport(businessId);
    const body = csv([
      ["תאריך", "שעה", "עד שעה", "לקוח", "טלפון", "שירות", "מחיר", "סטטוס", "הערות"],
      ...appts.map((a) => [
        formatHebrewDate(a.start_time),
        formatTime(a.start_time),
        formatTime(a.end_time),
        a.client ? `${a.client.first_name} ${a.client.last_name}` : "",
        a.client?.phone ?? "",
        a.service?.name ?? "",
        a.service?.price ?? "",
        a.status === "confirmed" ? "מאושר" : "בוטל",
        a.notes ?? "",
      ]),
    ]);
    return new NextResponse(body, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="appointments-${stamp}.csv"`,
        "Cache-Control": "private, no-store",
      },
    });
  }

  if (format === "clients") {
    const clients = await getClients(businessId);
    const body = csv([
      ["שם פרטי", "שם משפחה", "טלפון", "אימייל", "תאריך לידה", "הערות"],
      ...clients.map((c) => [c.first_name, c.last_name, c.phone, c.email ?? "", c.birthday ?? "", c.notes ?? ""]),
    ]);
    return new NextResponse(body, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="clients-${stamp}.csv"`,
        "Cache-Control": "private, no-store",
      },
    });
  }

  // Full JSON backup: everything of this business, never credentials.
  const [services, clients, appointments, waitlist, staff] = await Promise.all([
    getServices(businessId),
    getClients(businessId),
    getAllAppointmentsForExport(businessId),
    getWaitlist(businessId),
    getStaffByBusiness(businessId),
  ]);
  const backup = {
    exported_at: new Date().toISOString(),
    business: { ...toPublicBusiness(business), owner_email: business.owner_email },
    services,
    clients,
    appointments: appointments.map((a) => ({
      id: a.id,
      service_id: a.service_id,
      client_id: a.client_id,
      staff_id: a.staff_id ?? null,
      start_time: a.start_time,
      end_time: a.end_time,
      status: a.status,
      notes: a.notes ?? null,
      created_at: a.created_at,
    })),
    waitlist,
    staff: staff.map((s) => ({
      id: s.id,
      name: s.name,
      phone: s.phone,
      role: s.role,
      active: s.active,
    })),
  };
  return new NextResponse(JSON.stringify(backup, null, 2), {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="tornow-backup-${stamp}.json"`,
      "Cache-Control": "private, no-store",
    },
  });
}
