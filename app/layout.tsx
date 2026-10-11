import type { Metadata, Viewport } from "next";
import { Heebo } from "next/font/google";
import localFont from "next/font/local";
import "./globals.css";

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

export const metadata: Metadata = {
  title: "Torli | תורים בלי טלפונים",
  description: "תורלי: קביעת תורים מהטלפון לעסקים קטנים. הלקוחות קובעים לבד, התזכורות יוצאות בוואטסאפ.",
  applicationName: "Torli",
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

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="he" dir="rtl" className={`${plinko.variable} ${heebo.variable}`}>
      <body className="font-sans antialiased bg-paper text-ink-900">
        <main className="min-h-screen flex flex-col">{children}</main>
      </body>
    </html>
  );
}
