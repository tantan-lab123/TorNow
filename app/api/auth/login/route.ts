import { NextRequest, NextResponse } from "next/server";
import {
  getBusinessByPhone,
  getBusinessById,
  findBusinessByVerifiedGoogle,
  getStaffByPhone,
  setBusinessPasswordHash,
} from "@/lib/db";
import {
  hashPassword,
  setSessionCookie,
  toOwnerBusiness,
  verifyGoogleAccessToken,
  verifyPassword,
} from "@/lib/auth";
import { clientIp, rateLimit, tooMany } from "@/lib/rateLimit";

export const dynamic = "force-dynamic";

const FIFTEEN_MIN = 15 * 60 * 1000;

export async function POST(request: NextRequest) {
  try {
    const ip = clientIp(request);
    if (!rateLimit(`login:ip:${ip}`, 20, FIFTEEN_MIN)) return tooMany();

    const body = await request.json();

    // Google sign-in: identity is verified server-side from the Supabase access token.
    if (body.provider === "google") {
      const identity = await verifyGoogleAccessToken(body.access_token);
      if (!identity) {
        return NextResponse.json({ error: "אימות Google נכשל" }, { status: 401 });
      }
      const business = await findBusinessByVerifiedGoogle(identity.email, identity.id);
      if (!business) {
        return NextResponse.json({ error: "לא נמצא חשבון מקושר ל-Google זה" }, { status: 404 });
      }
      const res = NextResponse.json({ success: true, role: "owner", business: toOwnerBusiness(business) });
      setSessionCookie(res, business.id, "owner", undefined, business.password);
      return res;
    }

    // Credentials login (phone + password): business owner first, then staff members
    const { phone, password } = body;
    if (typeof phone !== "string" || typeof password !== "string" || !phone || !password) {
      return NextResponse.json({ error: "יש להזין מספר טלפון וסיסמה" }, { status: 400 });
    }
    const digits = phone.replace(/\D/g, "");
    if (!rateLimit(`login:phone:${digits}`, 6, FIFTEEN_MIN)) return tooMany();

    const business = await getBusinessByPhone(digits);
    const ownerCheck = verifyPassword(password, business?.password);
    if (business && ownerCheck.ok) {
      let storedHash = business.password;
      if (ownerCheck.needsRehash) {
        storedHash = hashPassword(password);
        await setBusinessPasswordHash(business.id, storedHash);
      }
      const res = NextResponse.json({ success: true, role: "owner", business: toOwnerBusiness(business) });
      setSessionCookie(res, business.id, "owner", undefined, storedHash);
      return res;
    }

    const staff = await getStaffByPhone(digits);
    const staffCheck = verifyPassword(password, staff?.password);
    if (staff && staff.active && staffCheck.ok) {
      const staffBusiness = await getBusinessById(staff.business_id);
      if (staffBusiness) {
        const res = NextResponse.json({
          success: true,
          role: staff.role,
          staff: { id: staff.id, name: staff.name },
          business: toOwnerBusiness(staffBusiness, staff.role, staff.id),
        });
        setSessionCookie(res, staffBusiness.id, staff.role, staff.id, staff.password);
        return res;
      }
    }

    return NextResponse.json({ error: "מספר טלפון או סיסמה אינם נכונים" }, { status: 401 });
  } catch (error) {
    console.error("Login error:", error);
    return NextResponse.json({ error: "שגיאת שרת במהלך ההתחברות" }, { status: 500 });
  }
}
