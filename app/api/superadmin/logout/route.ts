import { NextRequest, NextResponse } from "next/server";
import { clearSuperadminCookie, getSuperadmin } from "@/lib/superadmin/auth";
import { JSON_NO_STORE } from "@/lib/superadmin/config";

export const dynamic = "force-dynamic";

/** Sign out of /superadmin. Without a valid cookie it is a 401 like every other route here, but the cookie is cleared either way. */
export async function POST(request: NextRequest) {
  const admin = getSuperadmin(request);
  const res = admin
    ? NextResponse.json({ ok: true }, { headers: JSON_NO_STORE })
    : NextResponse.json({ error: "unauthorized" }, { status: 401, headers: JSON_NO_STORE });
  clearSuperadminCookie(res);
  return res;
}
