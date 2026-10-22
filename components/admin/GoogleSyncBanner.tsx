"use client";

import React, { useEffect, useState } from "react";
import { AlertTriangle } from "lucide-react";
import { alertDialog } from "@/lib/dialogs";
import { startGoogleCalendarConnect, type CalendarStatusDto } from "@/lib/google-calendar-client";

interface Props {
  role: "owner" | "manager" | "staff";
}

/**
 * Shown above the day's appointments only when something needs attention: appointments that
 * did not reach Google Calendar, or a connection that has to be renewed. Otherwise invisible.
 */
export const GoogleSyncBanner: React.FC<Props> = ({ role }) => {
  const [status, setStatus] = useState<CalendarStatusDto | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (role === "staff") return;
    let cancelled = false;
    const pull = () =>
      fetch("/api/google-calendar/status")
        .then((res) => (res.ok ? res.json() : null))
        .then((data) => {
          if (!cancelled && data) setStatus(data);
        })
        .catch(() => undefined);
    pull();
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") pull();
    }, 60_000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [role]);

  if (role === "staff" || !status) return null;
  if (!status.needsReconnect && status.failedCount === 0) return null;

  const retry = async () => {
    setBusy(true);
    try {
      const res = await fetch("/api/google-calendar/retry", { method: "POST" });
      if (!res.ok) throw new Error("failed");
      setStatus(await res.json());
    } catch {
      await alertDialog("לא הצלחנו לנסות שוב. נסו בעוד רגע.");
    } finally {
      setBusy(false);
    }
  };

  const reconnect = async () => {
    const result = await startGoogleCalendarConnect();
    if (!result.ok) await alertDialog(result.error);
  };

  return (
    <div
      role="alert"
      className="rounded-2xl border border-amber-300 bg-amber-50 px-4 py-3 flex flex-wrap items-center gap-3 text-right"
    >
      <AlertTriangle className="w-5 h-5 text-amber-600 flex-shrink-0" />
      <p className="flex-1 min-w-[200px] text-sm font-semibold text-amber-950">
        {status.needsReconnect
          ? "החיבור ליומן Google פג. תורים חדשים לא מגיעים ליומן עד שמחברים מחדש."
          : `${status.failedCount} תורים לא סונכרנו ליומן Google.`}
      </p>
      <div className="flex gap-2">
        {status.needsReconnect && role === "owner" && (
          <button
            type="button"
            onClick={reconnect}
            className="min-h-[44px] px-4 rounded-xl bg-brand-600 text-white text-sm font-bold"
          >
            חבר מחדש
          </button>
        )}
        {status.failedCount > 0 && !status.needsReconnect && (
          <button
            type="button"
            onClick={retry}
            disabled={busy}
            className="min-h-[44px] px-4 rounded-xl bg-brand-600 text-white text-sm font-bold disabled:opacity-60"
          >
            {busy ? "מנסה..." : "נסה שוב"}
          </button>
        )}
      </div>
    </div>
  );
};
