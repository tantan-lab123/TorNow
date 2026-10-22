import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireRole, OWNER_ONLY } from "@/lib/access";
import { verifySupabaseToken } from "@/lib/auth";
import { rateLimit, tooMany } from "@/lib/rateLimit";
import { GoogleApiError, GoogleAuthRevokedError, GoogleNotConfiguredError, isGoogleCalendarConfigured } from "@/lib/google-calendar";
import { connectCalendar, getCalendarStatus } from "@/lib/google-sync";
import { TokenCryptoError } from "@/lib/crypto-token";

export const dynamic = "force-dynamic";

const schema = z.object({
  // the Supabase session returned from Google, used to learn WHICH Google account was connected
  access_token: z.string().min(20).max(6000),
  // only present on the very first session after the Google redirect
  provider_refresh_token: z.string().min(10).max(2000).nullish(),
});

const NO_CACHE = { "Cache-Control": "no-store" };

/**
 * Owner only: stores the Google refresh token, encrypted, and creates the dedicated TorNow
 * calendar. The token arrives once, over HTTPS, and is never returned or logged.
 */
export async function POST(request: NextRequest) {
  try {
    const auth = await requireRole(request, OWNER_ONLY);
    if (auth.error) return auth.error;
    const businessId = auth.session.businessId;
    if (!rateLimit(`gcal-connect:${businessId}`, 10, 60 * 60 * 1000)) return tooMany();

    if (!isGoogleCalendarConfigured()) {
      return NextResponse.json(
        { error: "החיבור ליומן Google עוד לא הוגדר בשרת. פנו למי שמנהל את המערכת.", code: "not_configured" },
        { status: 503, headers: NO_CACHE }
      );
    }

    const parsed = schema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json({ error: "נתונים חסרים", code: "bad_request" }, { status: 400, headers: NO_CACHE });
    }

    // The Google account is taken from the verified Supabase session, never from the request body.
    const identity = await verifySupabaseToken(parsed.data.access_token, "google");
    if (!identity) {
      return NextResponse.json(
        { error: "אימות Google נכשל. נסו להתחבר שוב.", code: "bad_session" },
        { status: 401, headers: NO_CACHE }
      );
    }

    const refreshToken = parsed.data.provider_refresh_token;
    if (!refreshToken) {
      return NextResponse.json(
        {
          error:
            "גוגל לא מסר הרשאה מתמשכת. הסירו את הגישה של TorNow בחשבון Google (הגדרות החשבון ← אבטחה ← אפליקציות עם גישה) ונסו שוב.",
          code: "no_refresh_token",
        },
        { status: 400, headers: NO_CACHE }
      );
    }

    await connectCalendar({ businessId, googleEmail: identity.email, refreshToken });
    return NextResponse.json({ success: true, ...(await getCalendarStatus(businessId)) }, { headers: NO_CACHE });
  } catch (err) {
    if (err instanceof GoogleAuthRevokedError) {
      return NextResponse.json(
        { error: "גוגל דחה את ההרשאה. נסו לחבר שוב.", code: "revoked" },
        { status: 400, headers: NO_CACHE }
      );
    }
    if (err instanceof GoogleNotConfiguredError || err instanceof TokenCryptoError) {
      console.error("google calendar connect: server configuration problem:", err.name);
      return NextResponse.json(
        { error: "החיבור ליומן Google עוד לא הוגדר בשרת.", code: "not_configured" },
        { status: 503, headers: NO_CACHE }
      );
    }
    console.error("google calendar connect failed:", err instanceof GoogleApiError ? err.message : "unknown");
    return NextResponse.json(
      { error: "לא הצלחנו להשלים את החיבור ליומן Google. נסו שוב בעוד רגע.", code: "failed" },
      { status: 502, headers: NO_CACHE }
    );
  }
}
