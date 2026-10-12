import { NextRequest, NextResponse } from "next/server";
import { getBusinessBySlug } from "@/lib/db";
import { brandedCard } from "@/lib/og";

export const dynamic = "force-dynamic";

// Chat apps cache link previews hard, and they fetch this URL on every share: let the CDN absorb it.
const CACHE = "public, max-age=300, s-maxage=3600, stale-while-revalidate=86400";

/**
 * Public. The picture shown when a business's booking link is shared: the one the owner
 * uploaded in the settings, or an automatic card with the business name.
 */
export async function GET(_request: NextRequest, ctx: { params: Promise<{ slug: string }> }) {
  const { slug } = await ctx.params;
  const business = await getBusinessBySlug(slug);
  if (!business) return new NextResponse("Not found", { status: 404 });

  const custom = business.settings?.og_image_url;
  if (custom) {
    const m = /^data:(image\/(?:png|jpe?g|webp|gif));base64,([a-z0-9+/=]+)$/i.exec(custom);
    if (m) {
      return new Response(new Uint8Array(Buffer.from(m[2], "base64")), {
        headers: { "Content-Type": m[1].toLowerCase(), "Cache-Control": CACHE, "X-Content-Type-Options": "nosniff" },
      });
    }
    if (/^https:\/\//i.test(custom)) {
      return NextResponse.redirect(custom, { status: 302, headers: { "Cache-Control": CACHE } });
    }
  }

  return brandedCard(business.name, "קביעת תור אונליין", { "Cache-Control": CACHE });
}
