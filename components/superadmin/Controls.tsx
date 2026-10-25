"use client";

import React, { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

const btn =
  "m-key2 inline-flex h-11 items-center justify-center rounded-lg border border-ink-200 bg-white px-4 text-[15px] font-bold text-ink-900 disabled:opacity-60";

/** Reloads the numbers once. There is no automatic polling. */
export function RefreshButton() {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <button type="button" className={btn} disabled={pending} onClick={() => start(() => router.refresh())}>
      {pending ? "מרעננים..." : "רענון"}
    </button>
  );
}

export function LogoutButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  return (
    <button
      type="button"
      className={btn}
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        try {
          await fetch("/api/superadmin/logout", { method: "POST", cache: "no-store" });
        } finally {
          router.replace("/superadmin/login");
        }
      }}
    >
      יציאה
    </button>
  );
}
