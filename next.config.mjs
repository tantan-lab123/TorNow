const securityHeaders = [
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=()" },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
  // Content-Security-Policy is set per request (with a nonce) in proxy.ts
];

// The SMS manage link carries a secret: never indexed, never cached, never sent on in the Referer header.
const privateLinkHeaders = [
  { key: "Referrer-Policy", value: "no-referrer" },
  { key: "Cache-Control", value: "no-store" },
  { key: "X-Robots-Tag", value: "noindex, nofollow" },
];

// The operator dashboard: never indexed, never cached, never leaked through the Referer header.
const superadminHeaders = [
  { key: "X-Robots-Tag", value: "noindex, nofollow, noarchive" },
  { key: "Cache-Control", value: "no-store" },
  { key: "Referrer-Policy", value: "no-referrer" },
];

/** @type {import('next').NextConfig} */
const nextConfig = {
  poweredByHeader: false,
  // The product moved from torli-eight.vercel.app: old links and QR codes keep working.
  // Temporary (307) on purpose; switch to permanent once the move is settled.
  async redirects() {
    return [
      {
        source: "/:path*",
        has: [{ type: "host", value: "torli-eight.vercel.app" }],
        destination: "https://tornow-eight.vercel.app/:path*",
        permanent: false,
      },
    ];
  },
  async headers() {
    return [
      { source: "/:path*", headers: securityHeaders },
      { source: "/t/:path*", headers: privateLinkHeaders },
      { source: "/api/manage/:path*", headers: privateLinkHeaders },
      { source: "/superadmin", headers: superadminHeaders },
      { source: "/superadmin/:path*", headers: superadminHeaders },
      { source: "/api/superadmin/:path*", headers: superadminHeaders },
    ];
  },
};

export default nextConfig;
