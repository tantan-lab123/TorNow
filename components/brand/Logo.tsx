import React from "react";
import { cn } from "@/lib/utils";

/** The Torli mark: a "take a number" ticket with a perforation and a lime dot. */
export function LogoMark({ size = 32, className }: { size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      aria-hidden="true"
      className={cn("flex-none", className)}
    >
      <path
        d="M5 6h22a3 3 0 0 1 3 3v3a4 4 0 0 0 0 8v3a3 3 0 0 1-3 3H5a3 3 0 0 1-3-3v-3a4 4 0 0 0 0-8V9a3 3 0 0 1 3-3z"
        fill="#1E4D36"
      />
      <path d="M11.5 9.5v13" stroke="#CFEA6E" strokeWidth="1.6" strokeLinecap="round" strokeDasharray="0.1 3.2" />
      <circle cx="20.5" cy="16" r="3.4" fill="#CFEA6E" />
    </svg>
  );
}

/** Mark + wordmark. `sub` is an optional second line (business name, tagline). */
export function Logo({
  sub,
  size = 32,
  className,
}: {
  sub?: React.ReactNode;
  size?: number;
  className?: string;
}) {
  return (
    <span className={cn("inline-flex items-center gap-2.5", className)}>
      <LogoMark size={size} />
      <span className="flex flex-col leading-tight text-right">
        <span className="font-extrabold text-[17px] tracking-tight text-ink-900">Torli</span>
        {sub && <span className="text-xs text-ink-500 font-medium">{sub}</span>}
      </span>
    </span>
  );
}
