import { NextRequest, NextResponse, after } from "next/server";
import {
  deleteBlockedTime,
  getAppointmentById,
  getBusinessById,
  getStaffById,
  openWaitlistForSlot,
  setAppointmentStaff,
  updateAppointmentStatus,
} from "@/lib/db";
import { getValidSession, requireRole, ANY_ROLE } from "@/lib/access";
import { clientIp, rateLimit, tooMany } from "@/lib/rateLimit";
import { customerChangePolicy } from "@/lib/booking/policy";
import { israelDateString } from "@/lib/booking/slotGenerator";
import { notifyBusiness } from "@/lib/push";
import { syncAppointment } from "@/lib/google-sync";
import { formatHebrewDate, formatTime, isBlockedTime } from "@/lib/utils";

export const dynamic = "force-dynamic";

const UUID_RE = /^[A-Za-z0-9-]{6,64}$/; // uuid in prod, short ids in mock mode

// The appointment id is an unguessable capability link (sent to the client by
// reminder). Public callers only get the minimum needed for the cancel page.
export async function GET(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const params = await ctx.params;
  if (!rateLimit(`appt-get:${clientIp(request)}`, 60, 10 * 60 * 1000)) return tooMany();
  if (!UUID_RE.test(params.id)) {
    return NextResponse.json({ error: "התור לא נמצא" }, { status: 404 });
  }

  const a = await getAppointmentById(params.id);
  if (!a) return NextResponse.json({ error: "התור לא נמצא" }, { status: 404 });

  const business = await getBusinessById(a.business_id);
  const policy = customerChangePolicy(business ?? undefined, a.start_time);
  const canModify = a.status === "confirmed" && policy.allowed;

  return NextResponse.json({
    id: a.id,
    status: a.status,
    start_time: a.start_time,
    end_time: a.end_time,
    business_id: a.business_id,
    service_id: a.service_id,
    can_modify: canModify,
    modify_blocked_reason: a.status === "confirmed" && !policy.allowed ? policy.reason : undefined,
    cutoff_hours: policy.cutoffHours,
    service: a.service
      ? {
          name: a.service.name,
          duration_minutes: a.service.duration_minutes,
          price: a.service.price,
        }
      : undefined,
    business: a.business
      ? { name: a.business.name, slug: a.business.slug, owner_phone: a.business.owner_phone }
      : undefined,
    client: a.client
      ? { first_name: a.client.first_name, last_name: a.client.last_name }
      : undefined,
  });
}

export async function PATCH(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const params = await ctx.params;
    if (!rateLimit(`appt-patch:${clientIp(request)}`, 30, 10 * 60 * 1000)) return tooMany();
    if (!UUID_RE.test(params.id)) {
      return NextResponse.json({ error: "התור לא נמצא" }, { status: 404 });
    }

    const body = await request.json();
    const status = body.status;
    const hasStaff = Object.prototype.hasOwnProperty.call(body, "staff_id");
    if (status !== undefined && status !== "confirmed" && status !== "cancelled") {
      return NextResponse.json(
        { error: "סטטוס לא תקין (חייב להיות confirmed או cancelled)" },
        { status: 400 }
      );
    }
    if (status === undefined && !hasStaff) {
      return NextResponse.json({ error: "לא נשלח שינוי" }, { status: 400 });
    }

    const existing = await getAppointmentById(params.id);
    if (!existing) return NextResponse.json({ error: "התור לא נמצא" }, { status: 404 });

    const teamId = (await getValidSession(request))?.businessId ?? null;
    const isTeam = teamId !== null && teamId === existing.business_id;

    // Anything beyond a customer's own cancellation needs a logged-in member of this business.
    if (!isTeam && (status !== "cancelled" || hasStaff)) {
      return NextResponse.json({ error: "אין הרשאה לפעולה זו" }, { status: 403 });
    }

    if (isTeam) {
      // re-validate role + that a staff account is still active
      const auth = await requireRole(request, ANY_ROLE);
      if (auth.error) return auth.error;
    } else if (existing.status === "confirmed") {
      // Customer cancelling via the link: enforce the business's cancellation cutoff.
      const business = await getBusinessById(existing.business_id);
      const policy = customerChangePolicy(business ?? undefined, existing.start_time);
      if (!policy.allowed) {
        return NextResponse.json(
          { error: policy.reason, blocked: true, owner_phone: business?.owner_phone },
          { status: 403 }
        );
      }
    }

    if (hasStaff) {
      const sid = body.staff_id;
      if (sid !== null) {
        const st = typeof sid === "string" ? await getStaffById(sid) : null;
        if (!st || st.business_id !== existing.business_id) {
          return NextResponse.json({ error: "עובד לא נמצא" }, { status: 400 });
        }
      }
      await setAppointmentStaff(existing.id, sid);
    }

    let updated = existing;
    if (status !== undefined) {
      const u = await updateAppointmentStatus(params.id, status);
      if (!u) return NextResponse.json({ error: "התור לא נמצא" }, { status: 404 });
      updated = u;

      // Owner's Google Calendar: cancelled -> removed, restored -> created again
      after(() => syncAppointment(u.id));

      // A freed slot: flag everyone waiting for that day, and tell the owner.
      if (status === "cancelled" && existing.status === "confirmed" && existing.service_id) {
        after(async () => {
          try {
            const n = await openWaitlistForSlot(
              existing.business_id,
              israelDateString(existing.start_time),
              existing.start_time
            );
            await notifyBusiness(existing.business_id, {
              title: isTeam ? "תור בוטל" : "לקוח ביטל תור",
              body:
                `${existing.client?.first_name ?? "לקוח"} · ${formatHebrewDate(existing.start_time)} ${formatTime(existing.start_time)}` +
                (n > 0 ? ` · ${n} ממתינים ברשימת ההמתנה` : ""),
              url: "/admin",
            });
          } catch (e) {
            console.error("post-cancel tasks failed:", e);
          }
        });
      }
    }

    return NextResponse.json({
      success: true,
      appointment: { id: updated.id, status: updated.status },
    });
  } catch (error) {
    console.error("Error updating appointment status:", error);
    return NextResponse.json({ error: "שגיאה בעדכון סטטוס התור" }, { status: 500 });
  }
}

/**
 * Team only: remove a block of blocked time. Only blocks can be deleted here; a customer's
 * appointment is cancelled (PATCH), never erased. Customers waiting for that day are flagged.
 */
export async function DELETE(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const params = await ctx.params;
    if (!UUID_RE.test(params.id)) {
      return NextResponse.json({ error: "החסימה לא נמצאה" }, { status: 404 });
    }
    const auth = await requireRole(request, ANY_ROLE);
    if (auth.error) return auth.error;

    const existing = await getAppointmentById(params.id);
    if (!existing || existing.business_id !== auth.session.businessId) {
      return NextResponse.json({ error: "החסימה לא נמצאה" }, { status: 404 });
    }
    if (!isBlockedTime(existing)) {
      return NextResponse.json({ error: "אפשר למחוק רק זמן חסום. תור של לקוח מבטלים." }, { status: 400 });
    }

    const removed = await deleteBlockedTime(existing.id);
    if (!removed) return NextResponse.json({ error: "החסימה לא נמצאה" }, { status: 404 });

    if (existing.status === "confirmed") {
      after(async () => {
        try {
          await openWaitlistForSlot(
            existing.business_id,
            israelDateString(existing.start_time),
            existing.start_time
          );
        } catch (e) {
          console.error("post-unblock tasks failed:", e);
        }
      });
    }
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error removing blocked time:", error);
    return NextResponse.json({ error: "שגיאה בהסרת החסימה" }, { status: 500 });
  }
}
