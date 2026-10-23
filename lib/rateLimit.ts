import type { NextRequest } from "next/server";

// Best-effort in-memory limiter (per server instance). For multi-instance /
// serverless production, back this with Redis/Upstash for strict guarantees.
const buckets = new Map<string, { count: number; reset: number }>();

export function clientIpFromHeaders(headers: Headers): string {
  const xf = headers.get("x-forwarded-for");
  return (xf ? xf.split(",")[0].trim() : headers.get("x-real-ip")) || "unknown";
}

export function clientIp(request: NextRequest): string {
  return clientIpFromHeaders(request.headers);
}

/** Returns true when the request is ALLOWED. */
export function rateLimit(key: string, limit: number, windowMs: number): boolean {
  const now = Date.now();
  if (buckets.size > 5000) {
    buckets.forEach((v, k) => {
      if (v.reset < now) buckets.delete(k);
    });
  }
  const b = buckets.get(key);
  if (!b || b.reset < now) {
    buckets.set(key, { count: 1, reset: now + windowMs });
    return true;
  }
  b.count += 1;
  return b.count <= limit;
}

/** True while the key is over its limit. Does not count as an attempt. */
export function isRateLimited(key: string, limit: number): boolean {
  const b = buckets.get(key);
  return !!b && b.reset >= Date.now() && b.count >= limit;
}

/** Forget a key, e.g. after a successful login. */
export function clearRateLimit(key: string): void {
  buckets.delete(key);
}

export function tooMany() {
  return new Response(JSON.stringify({ error: "יותר מדי בקשות. נסו שוב בעוד מספר דקות." }), {
    status: 429,
    headers: { "Content-Type": "application/json", "Retry-After": "300" },
  });
}
