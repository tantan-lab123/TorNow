import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  getAppointments,
  getServices,
  getServiceById,
  createService,
  updateService,
  deleteService,
} from "@/lib/db";
import { forbidden } from "@/lib/auth";
import { requireRole, MANAGEMENT } from "@/lib/access";

export const dynamic = "force-dynamic";

const serviceFields = {
  name: z.string().trim().min(1).max(120),
  duration_minutes: z.coerce.number().int().min(1).max(1440),
  buffer_minutes: z.coerce.number().int().min(0).max(240),
  price: z.coerce.number().min(0).max(100000),
};
const createSchema = z.object({ ...serviceFields, buffer_minutes: serviceFields.buffer_minutes.default(5), price: serviceFields.price.default(0) });
const updateSchema = z.object({ id: z.string().min(1) }).extend(
  Object.fromEntries(Object.entries(serviceFields).map(([k, v]) => [k, v.optional()])) as {
    name: z.ZodOptional<typeof serviceFields.name>;
    duration_minutes: z.ZodOptional<typeof serviceFields.duration_minutes>;
    buffer_minutes: z.ZodOptional<typeof serviceFields.buffer_minutes>;
    price: z.ZodOptional<typeof serviceFields.price>;
  }
);

/** Public: the booking page lists a business's services. */
export async function GET(request: NextRequest) {
  const businessId = request.nextUrl.searchParams.get("business_id");
  if (!businessId) {
    return NextResponse.json({ error: "business_id parameter is required" }, { status: 400 });
  }
  return NextResponse.json(await getServices(businessId));
}

export async function POST(request: NextRequest) {
  try {
    const auth = await requireRole(request, MANAGEMENT);
    if (auth.error) return auth.error;
    const businessId = auth.session.businessId;

    const parsed = createSchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json({ error: "חסרים או שגויים שדות חובה (שם שירות, משך זמן)" }, { status: 400 });
    }
    const newService = await createService({ business_id: businessId, ...parsed.data });
    return NextResponse.json(newService);
  } catch (error) {
    console.error("Error creating service:", error);
    return NextResponse.json({ error: "שגיאה ביצירת שירות" }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const auth = await requireRole(request, MANAGEMENT);
    if (auth.error) return auth.error;
    const businessId = auth.session.businessId;

    const parsed = updateSchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json({ error: "נתוני שירות לא תקינים" }, { status: 400 });
    }
    const { id, ...updates } = parsed.data;

    const existing = await getServiceById(id);
    if (!existing) return NextResponse.json({ error: "שירות לא נמצא" }, { status: 404 });
    if (existing.business_id !== businessId) return forbidden();

    const cleaned = Object.fromEntries(Object.entries(updates).filter(([, v]) => v !== undefined));
    const updated = await updateService(id, cleaned);
    if (!updated) return NextResponse.json({ error: "שירות לא נמצא" }, { status: 404 });
    return NextResponse.json(updated);
  } catch (error) {
    console.error("Error updating service:", error);
    return NextResponse.json({ error: "שגיאה בעדכון שירות" }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const auth = await requireRole(request, MANAGEMENT);
    if (auth.error) return auth.error;
    const businessId = auth.session.businessId;

    const id = request.nextUrl.searchParams.get("id");
    if (!id) return NextResponse.json({ error: "חסר מזהה שירות" }, { status: 400 });

    const existing = await getServiceById(id);
    if (!existing) return NextResponse.json({ success: false }, { status: 404 });
    if (existing.business_id !== businessId) return forbidden();

    // Deleting would strip the service from bookings that still have to happen
    const upcoming = (await getAppointments(businessId, new Date().toISOString())).filter(
      (a) => a.service_id === id && a.status === "confirmed"
    ).length;
    if (upcoming > 0) {
      return NextResponse.json(
        {
          error:
            upcoming === 1
              ? "לשירות הזה יש תור עתידי אחד, ולכן עדיין אי אפשר למחוק אותו. אפשר למחוק אחרי שהתור יתקיים או יבוטל."
              : `לשירות הזה יש ${upcoming} תורים עתידיים, ולכן עדיין אי אפשר למחוק אותו. אפשר למחוק אחרי שהתורים יתקיימו או יבוטלו.`,
        },
        { status: 409 }
      );
    }

    return NextResponse.json({ success: await deleteService(id) });
  } catch (error) {
    console.error("Error deleting service:", error);
    return NextResponse.json({ error: "שגיאה במחיקת שירות" }, { status: 500 });
  }
}
