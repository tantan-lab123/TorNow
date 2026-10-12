import { NextRequest, NextResponse } from "next/server";

/**
 * Sets the Content-Security-Policy on every page, with a fresh nonce per request.
 *
 * Only scripts that carry the nonce (the ones Next.js itself adds) may run, so an inline
 * <script> injected through a bug in the site would be blocked by the browser instead of
 * executed. This replaces the old 'unsafe-inline' for scripts, which allowed any inline script.
 * (Styles keep 'unsafe-inline': React sets many style="" attributes, and style injection can
 * not run code.) Pages must be rendered per request for the nonce to be applied, see the
 * root layout.
 */
export function proxy(request: NextRequest) {
  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
  const isDev = process.env.NODE_ENV === "development";

  const csp = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${isDev ? " 'unsafe-eval'" : ""}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https:",
    "font-src 'self' data:",
    "connect-src 'self' https://*.supabase.co wss://*.supabase.co",
    "worker-src 'self'",
    "manifest-src 'self'",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "object-src 'none'",
    ...(isDev ? [] : ["upgrade-insecure-requests"]),
  ].join("; ");

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", csp);

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set("Content-Security-Policy", csp);
  return response;
}

export const config = {
  matcher: [
    {
      // pages only: not the API, built files, or the generated icons / manifest / sitemap / robots
      source: "/((?!api|_next/static|_next/image|favicon.ico|icon.svg|apple-icon.png|manifest.webmanifest|sitemap.xml|robots.txt|sw.js|screens).*)",
      missing: [
        { type: "header", key: "next-router-prefetch" },
        { type: "header", key: "purpose", value: "prefetch" },
      ],
    },
  ],
};
