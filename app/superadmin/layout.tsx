import type { Metadata } from "next";
import React from "react";

// The operator dashboard: private. Never indexed (see also X-Robots-Tag in next.config.mjs and robots.ts).
export const metadata: Metadata = {
  title: "ניהול",
  robots: { index: false, follow: false, nocache: true, noarchive: true },
  referrer: "no-referrer",
};

export default function SuperadminLayout({ children }: { children: React.ReactNode }) {
  return <div className="min-h-screen bg-paper text-ink-900">{children}</div>;
}
