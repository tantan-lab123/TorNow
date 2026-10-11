import React from "react";
import Image from "next/image";
import { cn } from "@/lib/utils";

/**
 * A phone body for the landing page. The screen keeps the 390x844 ratio of an iPhone:
 * a 44pt status bar, then a 390x800 app area where `children` go (the screenshots in
 * public/screens are exactly that size). Text inside can be sized in `cqw`.
 */
export function PhoneFrame({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div
      className={cn(
        "relative rounded-[44px] bg-ink-900 p-[8px] shadow-[0_40px_70px_-36px_rgba(23,32,26,0.6)] ring-1 ring-ink-950",
        className
      )}
    >
      <span aria-hidden="true" className="absolute left-[-3px] top-[17%] h-[5%] w-[3px] rounded-l-sm bg-ink-800" />
      <span aria-hidden="true" className="absolute left-[-3px] top-[24%] h-[8%] w-[3px] rounded-l-sm bg-ink-800" />
      <span aria-hidden="true" className="absolute right-[-3px] top-[21%] h-[11%] w-[3px] rounded-r-sm bg-ink-800" />
      <div className="relative aspect-[390/844] overflow-hidden rounded-[36px] bg-white [container-type:inline-size]">
        <StatusBar />
        <div className="absolute inset-x-0 bottom-0 top-[5.2%] overflow-hidden bg-paper">{children}</div>
      </div>
    </div>
  );
}

function StatusBar() {
  return (
    <div
      dir="ltr"
      aria-hidden="true"
      className="absolute inset-x-0 top-0 flex h-[5.2%] items-center justify-between px-[8cqw] text-[length:3.7cqw] font-semibold text-ink-900"
    >
      <span className="tabular-nums">10:40</span>
      <span className="absolute left-1/2 top-[16%] h-[66%] w-[29%] -translate-x-1/2 rounded-full bg-ink-900" />
      <span className="flex items-center gap-[1.3cqw]">
        <svg viewBox="0 0 17 11" className="w-[4.4cqw]" fill="currentColor">
          <rect x="0" y="7" width="3" height="4" rx="0.8" />
          <rect x="4.6" y="5" width="3" height="6" rx="0.8" />
          <rect x="9.2" y="2.6" width="3" height="8.4" rx="0.8" />
          <rect x="13.8" y="0" width="3" height="11" rx="0.8" />
        </svg>
        <svg viewBox="0 0 16 12" className="w-[4.1cqw]" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round">
          <path d="M1.4 4.4a9.4 9.4 0 0 1 13.2 0" />
          <path d="M3.9 7.1a5.9 5.9 0 0 1 8.2 0" />
          <path d="M6.5 9.8a2.3 2.3 0 0 1 3 0" />
        </svg>
        <svg viewBox="0 0 27 13" className="w-[6.6cqw]">
          <rect x="0.5" y="0.5" width="23" height="12" rx="3.6" fill="none" stroke="currentColor" strokeOpacity="0.4" />
          <rect x="2" y="2" width="17.5" height="9" rx="2.2" fill="currentColor" />
          <path d="M25 4.4v4.2c.9-.3 1.5-1.1 1.5-2.1s-.6-1.8-1.5-2.1z" fill="currentColor" fillOpacity="0.45" />
        </svg>
      </span>
    </div>
  );
}

/** One of the app screenshots in public/screens (390x800 at 2x). */
export function Screen({
  name,
  alt,
  className,
  eager,
  hidden,
}: {
  name: string;
  alt: string;
  className?: string;
  eager?: boolean;
  /** Stacked frames that are not showing stay out of the accessibility tree. */
  hidden?: boolean;
}) {
  return (
    <Image
      src={`/screens/${name}.webp`}
      alt={alt}
      width={780}
      height={1600}
      unoptimized
      loading={eager ? "eager" : "lazy"}
      draggable={false}
      aria-hidden={hidden || undefined}
      className={cn("absolute inset-0 h-full w-full select-none object-cover object-top", className)}
    />
  );
}
