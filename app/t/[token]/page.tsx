import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { ManageAppointment } from "@/components/booking/ManageAppointment";
import { clientIpFromHeaders, rateLimit } from "@/lib/rateLimit";
import { resolveManageToken } from "@/lib/sms/manage";

// The link from the confirmation SMS. Public on purpose (the token is the key), so it is never
// indexed, cached or leaked through the Referer header (see also next.config.mjs).
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "ניהול תור | TorNow",
  robots: { index: false, follow: false, nocache: true },
  referrer: "no-referrer",
};

export default async function ManageByTokenPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;

  const ip = clientIpFromHeaders(await headers());
  if (!rateLimit(`manage-page:${ip}`, 60, 10 * 60 * 1000)) {
    return (
      <main className="min-h-screen bg-slate-50 flex items-center justify-center p-4 text-center">
        <p className="text-sm text-slate-600">יותר מדי בקשות. נסו שוב בעוד מספר דקות.</p>
      </main>
    );
  }

  // wrong, unknown and expired links all end in the same generic 404
  if (!(await resolveManageToken(token))) notFound();

  return <ManageAppointment source={{ mode: "token", token }} />;
}
