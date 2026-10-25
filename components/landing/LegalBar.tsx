import React from "react";
import Link from "next/link";

/** The bottom line of the landing-page footers: copyright and the legal links (shared by the landing page and /pricing). */
export function LegalBar() {
  return (
    <div className="mt-12 flex flex-col justify-between gap-2 border-t border-ink-200 pt-6 text-[14px] text-ink-600 sm:flex-row">
      <span>© TorNow</span>
      <span className="flex flex-wrap gap-x-5">
        <Link href="/privacy" className="inline-flex min-h-11 items-center font-semibold hover:text-brand-600">
          מדיניות פרטיות
        </Link>
        <Link href="/terms" className="inline-flex min-h-11 items-center font-semibold hover:text-brand-600">
          תנאי שימוש
        </Link>
      </span>
      <span>תורים לעסקים קטנים בישראל</span>
    </div>
  );
}
