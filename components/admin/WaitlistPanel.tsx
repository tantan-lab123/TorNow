"use client";

import React, { useEffect, useState } from "react";
import { BellRing, Check, MessageCircle, X } from "lucide-react";
import { Card } from "@/components/ui/Card";
import { formatDayString, formatHebrewDate, formatTime, toInternationalPhone, triggerHaptic } from "@/lib/utils";

interface WaitEntry {
  id: string;
  phone: string;
  first_name: string;
  last_name: string;
  desired_date: string;
  status: "waiting" | "slot_open";
  opened_start: string | null;
  service?: { name: string } | null;
}

/** Customers waiting for a full day. When a booking is cancelled their row lights up. */
export const WaitlistPanel: React.FC<{ businessName: string }> = ({ businessName }) => {
  const [entries, setEntries] = useState<WaitEntry[]>([]);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const res = await fetch("/api/waitlist");
        const data = res.ok ? await res.json() : null;
        if (alive && data) setEntries(data);
      } catch {
        // ignore transient errors
      }
    };
    void load();
    const t = setInterval(load, 30_000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);

  const resolve = async (id: string, status: "done" | "cancelled") => {
    triggerHaptic(15);
    setEntries((prev) => prev.filter((e) => e.id !== id));
    await fetch("/api/waitlist", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, status }),
    });
  };

  if (entries.length === 0) return null;

  const open = entries.filter((e) => e.status === "slot_open");

  return (
    <Card className="p-4 bg-white border border-slate-200 shadow-xs text-right space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 font-extrabold text-sm text-slate-900">
          <BellRing className={`w-4 h-4 ${open.length ? "text-amber-500" : "text-ink-500"}`} />
          <span>רשימת המתנה ({entries.length})</span>
        </div>
        {open.length > 0 && (
          <span className="text-[11px] font-bold text-amber-700 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded-full">
            התפנה תור ל-{open.length}
          </span>
        )}
      </div>

      <ul className="space-y-2">
        {entries.map((e) => {
          const isOpen = e.status === "slot_open";
          const msg = encodeURIComponent(
            isOpen && e.opened_start
              ? `היי ${e.first_name}, התפנה תור ב${businessName} ב${formatHebrewDate(e.opened_start)} בשעה ${formatTime(e.opened_start)}. רוצה לקבוע? 🙂`
              : `היי ${e.first_name}, כאן ${businessName}. נעדכן אותך ברגע שיתפנה תור.`
          );
          return (
            <li
              key={e.id}
              className={`rounded-xl border p-3 flex flex-wrap items-center justify-between gap-2 ${
                isOpen ? "border-amber-300 bg-amber-50/60" : "border-slate-200 bg-slate-50/50"
              }`}
            >
              <div>
                <div className="font-bold text-sm text-slate-900">
                  {e.first_name} {e.last_name}
                </div>
                <div className="text-xs text-slate-500">
                  מחכה ל{formatDayString(e.desired_date)}
                  {e.service?.name ? ` · ${e.service.name}` : ""}
                </div>
                {isOpen && e.opened_start && (
                  <div className="text-xs font-bold text-amber-700 mt-0.5">
                    התפנה: {formatHebrewDate(e.opened_start)} {formatTime(e.opened_start)}
                  </div>
                )}
              </div>
              <div className="flex items-center gap-1.5">
                <a
                  href={`https://wa.me/${toInternationalPhone(e.phone)}?text=${msg}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 h-11 px-3 rounded-xl bg-emerald-50 text-emerald-700 border border-emerald-200 text-xs font-bold hover:bg-emerald-100"
                >
                  <MessageCircle className="w-3.5 h-3.5" />
                  <span>וואטסאפ</span>
                </a>
                <button
                  onClick={() => resolve(e.id, "done")}
                  className="h-11 w-11 rounded-xl bg-indigo-50 text-indigo-700 hover:bg-indigo-100 flex items-center justify-center"
                  title="טופל"
                >
                  <Check className="w-4 h-4" />
                </button>
                <button
                  onClick={() => resolve(e.id, "cancelled")}
                  className="h-11 w-11 rounded-xl bg-slate-100 text-slate-500 hover:bg-rose-50 hover:text-rose-600 flex items-center justify-center"
                  title="הסר מהרשימה"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </li>
          );
        })}
      </ul>
    </Card>
  );
};
