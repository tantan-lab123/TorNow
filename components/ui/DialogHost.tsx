"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { registerDialogHost, type DialogRequest } from "@/lib/dialogs";
import { cn } from "@/lib/utils";

/**
 * Mount once per page. Draws the dialogs requested through confirmDialog() / alertDialog().
 * Requests that arrive while one is open are queued, not dropped.
 */
export function DialogHost() {
  const [queue, setQueue] = useState<DialogRequest[]>([]);
  const confirmRef = useRef<HTMLButtonElement>(null);
  const current = queue[0];

  useEffect(() => registerDialogHost((request) => setQueue((q) => [...q, request])), []);

  const close = useCallback(
    (result: boolean) => {
      if (!current) return;
      current.resolve(result);
      setQueue((q) => q.slice(1));
    },
    [current]
  );

  useEffect(() => {
    if (!current) return;
    confirmRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [current, close]);

  if (!current) return null;
  const isConfirm = current.kind === "confirm";

  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center p-4">
      <div className="fixed inset-0 bg-ink-950/50 animate-in fade-in duration-150" onClick={() => close(false)} />
      <div
        role={isConfirm ? "alertdialog" : "dialog"}
        aria-modal="true"
        aria-labelledby="app-dialog-message"
        dir="rtl"
        className="relative z-10 w-full max-w-sm rounded-2xl bg-white p-5 text-right shadow-2xl animate-in zoom-in-95 duration-150"
      >
        {current.title && <h2 className="mb-1 text-base font-extrabold text-ink-900">{current.title}</h2>}
        <p id="app-dialog-message" className="text-sm font-semibold leading-relaxed text-ink-800">
          {current.message}
        </p>
        <div className="mt-5 flex flex-row-reverse gap-2">
          <button
            ref={confirmRef}
            type="button"
            onClick={() => close(true)}
            className={cn(
              "h-11 flex-1 rounded-xl px-4 text-sm font-bold text-white",
              current.danger ? "bg-danger-600 hover:bg-danger-700" : "bg-brand-600 hover:bg-brand-700"
            )}
          >
            {current.confirmLabel || (isConfirm ? "אישור" : "הבנתי")}
          </button>
          {isConfirm && (
            <button
              type="button"
              onClick={() => close(false)}
              className="h-11 flex-1 rounded-xl border border-ink-200 bg-white px-4 text-sm font-bold text-ink-800 hover:bg-ink-50"
            >
              {current.cancelLabel || "ביטול"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
