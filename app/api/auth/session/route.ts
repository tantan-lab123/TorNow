import { NextRequest, NextResponse } from "next/server";
import { getBusinessById, getStaffById } from "@/lib/db";
import { toOwnerBusiness, unauthorized } from "@/lib/auth";
import { getValidSession } from "@/lib/access";

export const dynamic = "force-dynamic";

/**
 * Returns the logged-in user's business and role (from the signed cookie).
 * `?probe=1` is for the admin page's "am I already signed in?" check: a visitor who is not
 * signed in gets 200 { signedIn: false } instead of a 401 (a red console error on every visit).
 */
export async function GET(request: NextRequest) {
  const probe = request.nextUrl.searchParams.get("probe") === "1";
  const notSignedIn = () => (probe ? NextResponse.json({ signedIn: false }) : unauthorized());

  const session = await getValidSession(request);
  if (!session) return notSignedIn();
  const business = await getBusinessById(session.businessId);
  if (!business) return notSignedIn();

  let staff: { id: string; name: string } | undefined;
  if (session.staffId) {
    const s = await getStaffById(session.staffId);
    // a disabled / deleted staff member loses access immediately
    if (!s || !s.active || s.business_id !== business.id) return notSignedIn();
    staff = { id: s.id, name: s.name };
  }
  return NextResponse.json({
    signedIn: true,
    role: session.role,
    staff,
    business: toOwnerBusiness(business, session.role),
  });
}
