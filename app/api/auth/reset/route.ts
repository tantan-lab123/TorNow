import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getBusinessByPhone, updateBusiness } from "@/lib/db";
import { verifySupabaseToken } from "@/lib/auth";
import { forgetCredentialCache } from "@/lib/access";
import { validatePassword } from "@/lib/utils";
import { isPasswordPwned, PWNED_ERROR } from "@/lib/pwned";
import { clientIp, rateLimit, tooMany } from "@/lib/rateLimit";

export const dynamic = "force-dynamic";

const schema = z.object({
  access_token: z.string().min(20).max(4000),
  phone: z.string().max(30),
  new_password: z.string().max(200),
});

const PASSWORD_ERROR =
  "הסיסמה חייבת להכיל לפחות 8 תווים, אות גדולה, אות קטנה, ספרה ותו מיוחד (!@#$%^&* וכו')";

/**
 * Step 2 of password recovery. Requires BOTH proof of the mailbox (the verified Supabase
 * session from the emailed link) and the account's phone number, which must belong to the
 * business whose email on file is that mailbox.
 */
export async function POST(request: NextRequest) {
  try {
    if (!rateLimit(`reset:ip:${clientIp(request)}`, 10, 60 * 60 * 1000)) return tooMany();

    const parsed = schema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json({ error: "נתונים חסרים" }, { status: 400 });
    }
    const { access_token, phone, new_password } = parsed.data;

    const identity = await verifySupabaseToken(access_token, "email");
    if (!identity) {
      return NextResponse.json({ error: "הקישור פג תוקף. אנא בקש קישור חדש." }, { status: 401 });
    }

    if (!validatePassword(new_password).isValid) {
      return NextResponse.json({ error: PASSWORD_ERROR }, { status: 400 });
    }
    if (await isPasswordPwned(new_password)) {
      return NextResponse.json({ error: PWNED_ERROR }, { status: 400 });
    }

    const business = await getBusinessByPhone(phone.replace(/\D/g, ""));
    if (!business || business.owner_email?.trim().toLowerCase() !== identity.email) {
      // same message for every mismatch
      return NextResponse.json({ error: "הפרטים אינם תואמים לחשבון" }, { status: 400 });
    }

    // the new password also signs out every device that used the old one
    await updateBusiness(business.id, { password: new_password });
    forgetCredentialCache(business.id);
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("reset-password error:", error);
    return NextResponse.json({ error: "שגיאה באיפוס הסיסמה" }, { status: 500 });
  }
}
