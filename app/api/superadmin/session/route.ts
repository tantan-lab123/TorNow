import { NextRequest, NextResponse } from "next/server";
import { verifyGoogleAccessToken } from "@/lib/auth";
import { clientIp, rateLimit, tooMany } from "@/lib/rateLimit";
import { logAccess } from "@/lib/superadmin/access-log";
import { createSuperadminToken, isAllowedEmail, setSuperadminCookie } from "@/lib/superadmin/auth";
import { JSON_NO_STORE, SESSION_RATE_LIMIT } from "@/lib/superadmin/config";

export const dynamic = "force-dynamic";

/** The same answer for "this token is no good" and "this account may not come in": nothing says who is allowed. */
const refused = () => NextResponse.json({ error: "לא ניתן להתחבר" }, { status: 401, headers: JSON_NO_STORE });

/**
 * Sign-in to /superadmin. The browser has signed in with Google through Supabase Auth and sends the
 * access token once; the server verifies it with Supabase (a confirmed Google account), checks the e-mail
 * against SUPERADMIN_EMAILS, and on success sets its OWN signed cookie. The token is never stored or logged.
 */
export async function POST(request: NextRequest) {
  const ip = clientIp(request);
  if (!rateLimit(`superadmin-session:${ip}`, SESSION_RATE_LIMIT.max, SESSION_RATE_LIMIT.windowMs)) {
    const res = tooMany();
    res.headers.set("Cache-Control", "no-store");
    return res;
  }

  const body = (await request.json().catch(() => null)) as { access_token?: unknown } | null;
  const identity = await verifyGoogleAccessToken(body?.access_token);
  if (!identity) {
    await logAccess({ success: false, reason: "bad_token", ip });
    return refused();
  }
  if (!isAllowedEmail(identity.email)) {
    await logAccess({ success: false, reason: "not_allowed", rejectedEmail: identity.email, ip });
    return refused();
  }

  await logAccess({ success: true, email: identity.email, ip });
  const res = NextResponse.json({ ok: true }, { headers: JSON_NO_STORE });
  setSuperadminCookie(res, createSuperadminToken(identity.email));
  return res;
}
