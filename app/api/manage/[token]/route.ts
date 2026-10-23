import { NextRequest, NextResponse } from "next/server";
import { getBusinessById } from "@/lib/db";
import { customerChangePolicy } from "@/lib/booking/policy";
import { clientIp, rateLimit, tooMany } from "@/lib/rateLimit";
import { resolveManageToken } from "@/lib/sms/manage";

export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" };
const notFoundJson = () => NextResponse.json({ error: "התור לא נמצא" }, { status: 404, headers: NO_STORE });

// The link in the SMS. Same answer shape as the appointment link, but only what the manage
// page shows: no last name, no phone, no email, no notes.
export async function GET(request: NextRequest, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params;
  if (!rateLimit(`manage-get:${clientIp(request)}`, 60, 10 * 60 * 1000)) return tooMany();

  const a = await resolveManageToken(token);
  if (!a) return notFoundJson();

  const business = await getBusinessById(a.business_id);
  const policy = customerChangePolicy(business ?? undefined, a.start_time);
  const canModify = a.status === "confirmed" && policy.allowed;

  return NextResponse.json(
    {
      status: a.status,
      start_time: a.start_time,
      end_time: a.end_time,
      business_id: a.business_id,
      service_id: a.service_id,
      can_modify: canModify,
      modify_blocked_reason: a.status === "confirmed" && !policy.allowed ? policy.reason : undefined,
      cutoff_hours: policy.cutoffHours,
      service: a.service
        ? { name: a.service.name, duration_minutes: a.service.duration_minutes, price: a.service.price }
        : undefined,
      business: a.business
        ? { name: a.business.name, slug: a.business.slug, owner_phone: a.business.owner_phone }
        : undefined,
      client: a.client ? { first_name: a.client.first_name } : undefined,
    },
    { headers: NO_STORE }
  );
}
