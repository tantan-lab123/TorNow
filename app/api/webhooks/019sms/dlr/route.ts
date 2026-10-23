import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "crypto";
import { handleDeliveryReport } from "@/lib/sms/service";

export const dynamic = "force-dynamic";

function secretMatches(given: string | null, expected: string | undefined): boolean {
  if (!expected || expected.length < 16 || !given) return false;
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

// 019 pushes delivery reports here (application/x-www-form-urlencoded, no signature), so the
// secret rides in the URL: /api/webhooks/019sms/dlr?s=<SMS_019_WEBHOOK_SECRET>.
// A valid request always gets a fast 200: if this endpoint stops answering 200, 019 stops pushing.
export async function POST(request: NextRequest) {
  if (!secretMatches(request.nextUrl.searchParams.get("s"), process.env.SMS_019_WEBHOOK_SECRET)) {
    return new NextResponse(null, { status: 401 });
  }
  try {
    const form = await request.formData();
    await handleDeliveryReport({
      externalId: form.get("external_id"),
      status: form.get("status"),
      date: form.get("date"),
    });
  } catch {
    // unreadable body or a database hiccup: still 200, nothing personal is logged
    console.error("019 delivery report not processed");
  }
  return new NextResponse("OK", { status: 200, headers: { "Cache-Control": "no-store" } });
}
