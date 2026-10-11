import type { Metadata } from "next";
import { cache } from "react";
import { notFound } from "next/navigation";
import { getBusinessBySlug } from "@/lib/db";
import { dropLegacyPrefills } from "@/lib/validation";
import BookingPage from "./BookingPage";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ slug: string }> };

// One database read shared by the metadata and the page
const loadBusiness = cache((slug: string) => getBusinessBySlug(slug));

/** Link previews (WhatsApp, Instagram) show the business, not the platform. */
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const business = await loadBusiness(slug);
  if (!business) return { title: "העמוד לא נמצא | Torli" };

  // (never the old sample address some businesses still have stored)
  const address = dropLegacyPrefills(business.settings)?.address?.trim();
  const title = `${business.name} | קביעת תור`;
  const description = address
    ? `קביעת תור אונליין ב${business.name}, ${address}. בוחרים שירות ושעה, בלי שיחת טלפון.`
    : `קביעת תור אונליין ב${business.name}. בוחרים שירות ושעה, בלי שיחת טלפון.`;
  return {
    title,
    description,
    openGraph: { title, description, type: "website", locale: "he_IL", siteName: "Torli" },
    twitter: { card: "summary", title, description },
  };
}

export default async function Page({ params }: Props) {
  const { slug } = await params;
  // Unknown addresses (and paths like /robots.txt) get a real 404, not an empty booking page
  if (!(await loadBusiness(slug))) notFound();
  return <BookingPage />;
}
