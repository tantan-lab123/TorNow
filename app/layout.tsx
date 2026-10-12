import type { Metadata, Viewport } from "next";
import { Heebo } from "next/font/google";
import localFont from "next/font/local";
import { connection } from "next/server";
import "./globals.css";
import { DialogHost } from "@/components/ui/DialogHost";

// Brand font: Plinko FS (variable weight 100-800). Heebo is the fallback.
const plinko = localFont({
  src: "./fonts/PlinkoFS-VF.woff2",
  weight: "100 800",
  variable: "--font-brand",
  display: "swap",
});

const heebo = Heebo({
  subsets: ["hebrew", "latin"],
  weight: ["400", "500", "600", "700", "800"],
  variable: "--font-heebo",
  display: "swap",
});

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || "https://torli-eight.vercel.app";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: "Torli | תורים בלי טלפונים",
  description: "תורלי: קביעת תורים מהטלפון לעסקים קטנים. הלקוחות קובעים לבד, ותזכורת יוצאת מהוואטסאפ שלכם בלחיצה.",
  applicationName: "Torli",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "Torli",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#1E4D36",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // Every page is rendered per request so the Content-Security-Policy nonce (proxy.ts) can be applied
  await connection();
  return (
    <html lang="he" dir="rtl" className={`${plinko.variable} ${heebo.variable}`}>
      <body className="font-sans antialiased bg-paper text-ink-900">
        <div className="min-h-screen flex flex-col">{children}</div>
        <DialogHost />
      </body>
    </html>
  );
}
