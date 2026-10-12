import { NextRequest, NextResponse } from "next/server";
import {
  getBusinessBySlug,
  getBusinessByPhone,
  getBusinessById,
  updateBusiness,
  createBusiness,
  deleteBusiness,
} from "@/lib/db";
import { validatePassword, generateRandomSlug } from "@/lib/utils";
import {
  forbidden,
  setSessionCookie,
  clearSessionCookie,
  toOwnerBusiness,
  toPublicBusiness,
  verifyGoogleAccessToken,
} from "@/lib/auth";
import { isPasswordPwned, PWNED_ERROR } from "@/lib/pwned";
import { clientIp, rateLimit, tooMany } from "@/lib/rateLimit";
import { forgetCredentialCache, getValidSession, requireRole, MANAGEMENT, OWNER_ONLY } from "@/lib/access";
import { sanitizeDateOverrides, sanitizeSettings, sanitizeWorkingHours } from "@/lib/validation";

export const dynamic = "force-dynamic";

// Addresses that already belong to the site (/admin, /api/..., /cancel/...): a business with one
// of these would register fine and then have a booking link that never opens.
const RESERVED_SLUGS = new Set([
  "admin", "api", "cancel", "login", "logout", "register", "signup", "reset", "forgot",
  "manifest", "sitemap", "robots", "favicon", "icon", "apple", "static", "next", "public",
  "app", "www", "torli", "support", "help", "terms", "privacy", "about", "contact",
]);

const PASSWORD_ERROR =
  "הסיסמה חייבת להכיל לפחות 8 תווים, אות גדולה, אות קטנה, ספרה ותו מיוחד (!@#$%^&* וכו')";

/** Public: a single business by slug or id, without any private fields. */
export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const slug = searchParams.get("slug");
  const id = searchParams.get("id");

  const business = slug
    ? await getBusinessBySlug(slug)
    : id
    ? await getBusinessById(id)
    : null;

  if (!slug && !id) {
    return NextResponse.json({ error: "slug or id is required" }, { status: 400 });
  }
  if (!business) {
    return NextResponse.json({ error: "עסק לא נמצא" }, { status: 404 });
  }

  // Logged-in users of this business get their full view (calendar token only for owner/manager).
  const session = await getValidSession(request);
  if (session?.businessId === business.id) {
    return NextResponse.json(toOwnerBusiness(business, session.role));
  }
  return NextResponse.json(toPublicBusiness(business));
}

export async function PATCH(request: NextRequest) {
  try {
    const auth = await requireRole(request, MANAGEMENT);
    if (auth.error) return auth.error;
    const sessionId = auth.session.businessId;

    const body = await request.json();
    const {
      id,
      name,
      owner_phone,
      owner_email,
      password,
      working_hours,
      slot_interval_minutes,
      date_overrides,
      settings,
    } = body;

    // Only their own business may be modified.
    if (id && id !== sessionId) return forbidden();
    // Credentials and account identity are owner-only (managers run the business, not the account).
    const isOwner = auth.session.role === "owner";
    if (!isOwner && password !== undefined) {
      return forbidden("רק בעל העסק יכול לשנות את סיסמת החשבון");
    }
    const businessId = sessionId;

    if (password !== undefined) {
      if (typeof password !== "string" || !validatePassword(password).isValid) {
        return NextResponse.json({ error: PASSWORD_ERROR }, { status: 400 });
      }
      if (await isPasswordPwned(password)) {
        return NextResponse.json({ error: PWNED_ERROR }, { status: 400 });
      }
    }
    if (name !== undefined && (typeof name !== "string" || name.trim().length < 1 || name.length > 120)) {
      return NextResponse.json({ error: "שם עסק לא תקין" }, { status: 400 });
    }
    if (isOwner && owner_phone !== undefined) {
      const digits = String(owner_phone).replace(/\D/g, "");
      if (digits.length !== 10 || !digits.startsWith("0")) {
        return NextResponse.json({ error: "מספר טלפון לא תקין" }, { status: 400 });
      }
      const taken = await getBusinessByPhone(digits);
      if (taken && taken.id !== businessId) {
        return NextResponse.json({ error: "מספר הטלפון כבר רשום במערכת" }, { status: 409 });
      }
    }
    if (
      slot_interval_minutes !== undefined &&
      ![5, 10, 15, 20, 30, 45, 60, 90, 120].includes(Number(slot_interval_minutes))
    ) {
      return NextResponse.json({ error: "מרווח זמן לא תקין" }, { status: 400 });
    }
    // Whitelist + sanitise client-controlled JSON (blocks javascript: links, oversized/odd shapes).
    const cleanSettings = settings !== undefined ? sanitizeSettings(settings) : undefined;
    const cleanHours = working_hours !== undefined ? sanitizeWorkingHours(working_hours) : undefined;
    if (working_hours !== undefined && !cleanHours) {
      return NextResponse.json({ error: "שעות עבודה לא תקינות" }, { status: 400 });
    }
    const cleanOverrides = date_overrides !== undefined ? sanitizeDateOverrides(date_overrides) : undefined;
    if (date_overrides !== undefined && !cleanOverrides) {
      return NextResponse.json({ error: "חריגות תאריך לא תקינות" }, { status: 400 });
    }

    const updated = await updateBusiness(businessId, {
      ...(name ? { name: name.trim() } : {}),
      ...(isOwner && owner_phone ? { owner_phone } : {}),
      ...(isOwner && owner_email ? { owner_email: String(owner_email).trim().slice(0, 254) } : {}),
      ...(password ? { password } : {}),
      ...(cleanHours ? { working_hours: cleanHours } : {}),
      ...(slot_interval_minutes !== undefined
        ? { slot_interval_minutes: Number(slot_interval_minutes) }
        : {}),
      ...(cleanOverrides ? { date_overrides: cleanOverrides } : {}),
      ...(cleanSettings !== undefined ? { settings: cleanSettings } : {}),
    });

    if (!updated) {
      return NextResponse.json({ error: "עסק לא נמצא" }, { status: 404 });
    }
    const res = NextResponse.json(toOwnerBusiness(updated, auth.session.role));
    if (password) {
      // every other device is signed out; this one gets a session for the new password
      forgetCredentialCache(businessId);
      setSessionCookie(res, businessId, "owner", undefined, updated.password);
    }
    return res;
  } catch (error) {
    console.error("Error updating business:", error);
    return NextResponse.json({ error: "שגיאה בעדכון פרטי העסק" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    if (!rateLimit(`register:${clientIp(request)}`, 5, 60 * 60 * 1000)) return tooMany();

    const body = await request.json();
    const { name, slug, owner_phone, owner_email, password, access_token, category, slot_interval_minutes } =
      body;

    if (typeof name !== "string" || !name.trim() || name.length > 120 || !owner_phone) {
      return NextResponse.json({ error: "יש למלא שם עסק ומספר טלפון" }, { status: 400 });
    }
    const phoneDigits = String(owner_phone).replace(/\D/g, "");
    if (phoneDigits.length !== 10 || !phoneDigits.startsWith("0")) {
      return NextResponse.json({ error: "מספר טלפון לא תקין" }, { status: 400 });
    }

    // Google registration: the identity must be proven with a valid Supabase token.
    let googleIdentity: { email: string; id: string } | null = null;
    if (access_token) {
      googleIdentity = await verifyGoogleAccessToken(access_token);
      if (!googleIdentity) {
        return NextResponse.json({ error: "אימות Google נכשל" }, { status: 401 });
      }
    } else {
      if (typeof password !== "string" || !password) {
        return NextResponse.json(
          { error: "יש להגדיר סיסמה מאובטחת או להתחבר באמצעות חשבון Google" },
          { status: 400 }
        );
      }
      if (!validatePassword(password).isValid) {
        return NextResponse.json({ error: PASSWORD_ERROR }, { status: 400 });
      }
      if (await isPasswordPwned(password)) {
        return NextResponse.json({ error: PWNED_ERROR }, { status: 400 });
      }
    }

    if (await getBusinessByPhone(phoneDigits)) {
      return NextResponse.json({ error: "מספר הטלפון כבר רשום במערכת" }, { status: 409 });
    }

    let finalSlug =
      typeof slug === "string" ? slug.trim().toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 40) : "";
    // A chosen address must be usable: not a one-letter link, and not a word the site itself uses
    if (finalSlug && (finalSlug.length < 3 || RESERVED_SLUGS.has(finalSlug))) {
      return NextResponse.json(
        { error: "כתובת הקישור צריכה להיות באורך של 3 תווים לפחות (אותיות באנגלית ומספרים), ולא מילה שמורה. אנא בחרו אחרת." },
        { status: 400 }
      );
    }
    if (!finalSlug) finalSlug = generateRandomSlug(6);

    let existing = await getBusinessBySlug(finalSlug);
    if (existing && !slug) {
      finalSlug = generateRandomSlug(6);
      existing = await getBusinessBySlug(finalSlug);
    }
    if (existing) {
      return NextResponse.json(
        { error: "מזהה קישור (Slug) זה כבר תפוס במערכת. אנא בחר סיומת אחרת." },
        { status: 409 }
      );
    }

    const newBusiness = await createBusiness({
      name,
      slug: finalSlug,
      owner_phone: phoneDigits,
      owner_email: googleIdentity ? googleIdentity.email : owner_email,
      password: googleIdentity ? undefined : password,
      google_id: googleIdentity?.id,
      category,
      slot_interval_minutes: slot_interval_minutes ? Number(slot_interval_minutes) : undefined,
    });

    const res = NextResponse.json({ success: true, business: toOwnerBusiness(newBusiness) });
    setSessionCookie(res, newBusiness.id, "owner", undefined, newBusiness.password);
    return res;
  } catch (error) {
    console.error("Error creating business:", error);
    return NextResponse.json({ error: "שגיאה ביצירת עסק חדש" }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const auth = await requireRole(request, OWNER_ONLY);
    if (auth.error) return auth.error;
    const sessionId = auth.session.businessId;

    const id = request.nextUrl.searchParams.get("id");
    if (id && id !== sessionId) return forbidden();

    await deleteBusiness(sessionId);

    const res = NextResponse.json({
      success: true,
      message: "העסק וכל הנתונים המקושרים אליו נמחקו לצמיתות בהצלחה",
    });
    clearSessionCookie(res);
    return res;
  } catch (error) {
    console.error("Error deleting business:", error);
    return NextResponse.json({ error: "שגיאה במחיקת העסק מהמערכת" }, { status: 500 });
  }
}
