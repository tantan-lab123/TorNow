import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  getAppointments,
  getBusinessById,
  getServices,
  findOrCreateClient,
  createAppointment,
  blockTimeSlot,
  upsertCustomerProfile,
  getStaffById,
  setAppointmentStaff,
} from "@/lib/db";
import {
  addMinutes,
  isBefore,
  isAfter,
  parseISO,
  isSameDay,
  isSameWeek,
  isSameMonth,
  startOfMonth,
  subDays,
} from "date-fns";
import { after } from "next/server";
import { forbidden, getSessionBusinessId, verifyGoogleAccessToken } from "@/lib/auth";
import { requireRole, ANY_ROLE } from "@/lib/access";
import { notifyBusiness } from "@/lib/push";
import { formatHebrewDate, formatTime } from "@/lib/utils";
import { TZDate } from "@date-fns/tz";
import {
  BUSINESS_TZ,
  bookingWindow,
  generateAvailableSlots,
  israelDateString,
} from "@/lib/booking/slotGenerator";
import { clientIp, rateLimit, tooMany } from "@/lib/rateLimit";

export const dynamic = "force-dynamic";

const bookingSchema = z.object({
  business_id: z.string().min(1, "חסר מזהה עסק").max(64),
  service_id: z.string().min(1, "יש לבחור שירות").max(64),
  phone: z
    .string()
    .max(30)
    .transform((val) => val.replace(/\D/g, ""))
    .refine((val) => val.length === 10, {
      message: "מספר הטלפון חייב להכיל בדיוק 10 ספרות (לדוגמה: 0501234567)",
    })
    .refine((val) => val.startsWith("0"), {
      message: "מספר טלפון ישראלי חייב להתחיל בספרה 0",
    }),
  first_name: z.string().trim().min(2, "יש להזין שם פרטי").max(60),
  last_name: z.string().trim().min(2, "יש להזין שם משפחה").max(60),
  email: z.string().email("כתובת אימייל לא תקינה").max(254).optional().or(z.literal("")),
  start_time: z.string().datetime("זמן לא תקין"),
  notes: z.string().max(500, "ההערה ארוכה מדי").optional(),
  // Supabase access token of a customer who signed in with Google (identity is verified server-side)
  access_token: z.string().max(4000).optional(),
  // only honoured for logged-in staff/owner (manual bookings)
  staff_id: z.string().max(64).optional(),
});

const blockSlotSchema = z.object({
  business_id: z.string().min(1),
  start_time: z.string().datetime(),
  end_time: z.string().datetime(),
  reason: z.string().max(120).default("הפסקה / סידורים"),
});

/** An instant on the Israeli wall clock, so day/week/month math matches the business. */
const inIsrael = (instant: string | Date) => new TZDate(new Date(instant), BUSINESS_TZ);

/** Logged-in team only: the appointment book with client details. */
export async function GET(request: NextRequest) {
  const auth = await requireRole(request, ANY_ROLE);
  if (auth.error) return auth.error;
  const sessionId = auth.session.businessId;

  const { searchParams } = request.nextUrl;
  const businessId = searchParams.get("business_id");
  if (!businessId) {
    return NextResponse.json({ error: "business_id parameter is required" }, { status: 400 });
  }
  if (businessId !== sessionId) return forbidden();

  const appointments = await getAppointments(
    businessId,
    searchParams.get("start_date") || undefined,
    searchParams.get("end_date") || undefined
  );
  return NextResponse.json(appointments);
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    // Owner blocks a time range
    if (body.is_block) {
      const auth = await requireRole(request, ANY_ROLE);
      if (auth.error) return auth.error;
      const sessionId = auth.session.businessId;
      const parsedBlock = blockSlotSchema.safeParse(body);
      if (!parsedBlock.success) {
        return NextResponse.json(
          { error: parsedBlock.error.issues[0]?.message || "נתונים שגויים לחסימת זמן" },
          { status: 400 }
        );
      }
      if (parsedBlock.data.business_id !== sessionId) return forbidden();
      if (!isBefore(parseISO(parsedBlock.data.start_time), parseISO(parsedBlock.data.end_time))) {
        return NextResponse.json({ error: "טווח זמן לא תקין" }, { status: 400 });
      }
      const blocked = await blockTimeSlot(parsedBlock.data);
      return NextResponse.json({ success: true, appointment: blocked });
    }

    // Booking (public customers, or the business team adding one manually)
    const ip = clientIp(request);
    const teamSessionId = getSessionBusinessId(request);
    const isTeam = teamSessionId !== null && teamSessionId === body?.business_id;
    if (!isTeam && !rateLimit(`book:ip:${ip}`, 10, 60 * 60 * 1000)) return tooMany();

    const parsed = bookingSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message || "נתונים שגויים בטופס" },
        { status: 400 }
      );
    }
    const { business_id, service_id, phone, first_name, last_name, start_time, notes, access_token } =
      parsed.data;
    let email = parsed.data.email;

    // Verified Google identity (never trusted from the request body)
    let google: { email: string; id: string } | null = null;
    if (access_token) {
      google = await verifyGoogleAccessToken(access_token);
      if (!google) {
        return NextResponse.json({ error: "ההתחברות עם Google פגה. אנא התחבר שוב." }, { status: 401 });
      }
      email = google.email;
    }
    if (!isTeam && !rateLimit(`book:phone:${phone}`, 5, 60 * 60 * 1000)) return tooMany();

    const business = await getBusinessById(business_id);
    if (!business) {
      return NextResponse.json({ error: "עסק לא נמצא" }, { status: 404 });
    }

    const services = await getServices(business_id);
    const service = services.find((s) => s.id === service_id);
    if (!service) {
      return NextResponse.json({ error: "שירות לא נמצא" }, { status: 404 });
    }

    const totalMinutes = service.duration_minutes + (service.buffer_minutes || 0);
    const slotStart = parseISO(start_time);
    const slotEnd = addMinutes(slotStart, totalMinutes);
    const slotEndIso = slotEnd.toISOString();

    // Respect the business booking window (server-side, not only in the UI)
    const limits = bookingWindow(business);
    if (!isTeam && isBefore(slotStart, limits.earliest)) {
      return NextResponse.json({ error: "השעה הזו כבר קרובה מדי. אנא בחרו שעה אחרת." }, { status: 400 });
    }
    if (!isTeam && isAfter(slotStart, limits.latest)) {
      return NextResponse.json({ error: "לא ניתן לקבוע תור רחוק כל כך קדימה" }, { status: 400 });
    }

    // Everything the checks below need: the booked month with a week either side
    // (day/week/month limits) and every later appointment. Never the whole history.
    const existing = await getAppointments(
      business_id,
      new Date(Math.min(Date.now(), subDays(startOfMonth(inIsrael(slotStart)), 8).getTime())).toISOString()
    );

    // The requested start must be one of the slots the business actually offers
    // (working hours, lunch break, closures, past times) in Israel time.
    const offered = generateAvailableSlots({
      business,
      service,
      selectedDate: parseISO(israelDateString(slotStart)),
      existingAppointments: existing,
      stepMinutes: business.slot_interval_minutes || 15,
    });
    // (the business team may deliberately book outside the offered grid; collisions are still blocked)
    if (
      !isTeam &&
      !offered.slots.some((sl) => new Date(sl.startTime).getTime() === slotStart.getTime())
    ) {
      return NextResponse.json(
        { error: "השעה שנבחרה אינה זמינה. אנא בחר מועד אחר." },
        { status: 409 }
      );
    }

    // Double-booking check (the DB exclusion constraint is the hard guarantee)
    const collision = existing.some((app) => {
      if (app.status === "cancelled") return false;
      const appStart = parseISO(app.start_time);
      const appEnd = parseISO(app.end_time);
      return isBefore(appStart, slotEnd) && isAfter(appEnd, slotStart);
    });
    if (collision) {
      return NextResponse.json(
        { error: "השעה שנבחרה כבר נתפסה. אנא בחר מועד אחר." },
        { status: 409 }
      );
    }

    // Public guests are always "guest": identity fields are never trusted from the client.
    const client = await findOrCreateClient(business_id, {
      phone,
      first_name,
      last_name,
      email: email || undefined,
      google_id: google?.id,
      auth_provider: google ? "google" : "guest",
    });

    const clientActiveAppointments = existing.filter(
      (app) => app.client_id === client.id && app.status !== "cancelled"
    );

    const tooMuch = (limit: number, unit: string, count: number) =>
      limit > 0 && count >= limit
        ? NextResponse.json(
            { error: `הגעת למגבלת התורים המותרת ${unit} (${limit} ${limit === 1 ? "תור" : "תורים"}).` },
            { status: 400 }
          )
        : null;

    const dayLimit = isTeam ? null : tooMuch(
      business.settings?.max_appointments_per_day ?? 0,
      "ליום אחד",
      clientActiveAppointments.filter((a) => isSameDay(inIsrael(a.start_time), inIsrael(slotStart))).length
    );
    if (dayLimit) return dayLimit;
    const weekLimit = isTeam ? null : tooMuch(
      business.settings?.max_appointments_per_week ?? 0,
      "לשבוע אחד",
      clientActiveAppointments.filter((a) =>
        isSameWeek(inIsrael(a.start_time), inIsrael(slotStart), { weekStartsOn: 0 })
      ).length
    );
    if (weekLimit) return weekLimit;
    const monthLimit = isTeam ? null : tooMuch(
      business.settings?.max_appointments_per_month ?? 0,
      "לחודש",
      clientActiveAppointments.filter((a) => isSameMonth(inIsrael(a.start_time), inIsrael(slotStart))).length
    );
    if (monthLimit) return monthLimit;

    const appointment = await createAppointment({
      business_id,
      service_id,
      client_id: client.id,
      start_time,
      end_time: slotEndIso,
      notes,
    });

    // Manual booking by the team may be assigned to an employee of the same business
    if (isTeam && parsed.data.staff_id) {
      const st = await getStaffById(parsed.data.staff_id);
      if (st && st.business_id === business_id) {
        await setAppointmentStaff(appointment.id, st.id);
      }
    }

    // Free browser push to the owner's devices (does not delay the response)
    if (!isTeam) {
      after(() =>
        notifyBusiness(business_id, {
          title: "תור חדש נקבע 🎉",
          body: `${first_name} ${last_name} · ${service.name} · ${formatHebrewDate(appointment.start_time)} ${formatTime(appointment.start_time)}`,
          url: "/admin",
        })
      );
    }

    // Remember a Google customer's details so the next booking is one tap
    if (google) {
      await upsertCustomerProfile({
        google_id: google.id,
        email: google.email,
        first_name,
        last_name,
        phone,
      });
    }

    // Never echo other people's data back to a public caller.
    return NextResponse.json({
      success: true,
      appointment: {
        id: appointment.id,
        start_time: appointment.start_time,
        end_time: appointment.end_time,
        status: appointment.status,
        service: appointment.service,
        business: appointment.business
          ? { name: appointment.business.name, slug: appointment.business.slug }
          : undefined,
      },
    });
  } catch (error: unknown) {
    // 23P01 = exclusion_violation: someone booked the same slot a moment earlier.
    if ((error as { code?: string })?.code === "23P01") {
      return NextResponse.json(
        { error: "השעה שנבחרה כבר נתפסה. אנא בחר מועד אחר." },
        { status: 409 }
      );
    }
    console.error("Error creating appointment:", error);
    return NextResponse.json({ error: "שגיאה ביצירת התור. אנא נסה שוב." }, { status: 500 });
  }
}
