"use client";

import React, { useEffect, useState } from "react";
import { MessageCircle, Phone } from "lucide-react";
import { Appointment } from "@/lib/types";
import { formatTime, isBlockedTime, toInternationalPhone } from "@/lib/utils";

interface NextUpTicketProps {
  appointments: Appointment[];
}

function minutesUntil(iso: string, now: number) {
  return Math.round((new Date(iso).getTime() - now) / 60000);
}

function inWords(min: number) {
  if (min <= 0) return "עכשיו";
  if (min < 60) return `בעוד ${min} דק׳`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  const hours = h === 1 ? "שעה" : h === 2 ? "שעתיים" : `${h} שעות`;
  return m ? `בעוד ${hours} ו-${m} דק׳` : `בעוד ${hours}`;
}

/**
 * The "take a number" ticket from the design: who is in the chair now, or who is next today.
 * Renders nothing when the day has no more appointments.
 */
export function NextUpTicket({ appointments }: NextUpTicketProps) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(id);
  }, []);

  const live = appointments
    .filter((a) => a.status !== "cancelled" && !isBlockedTime(a))
    .filter((a) => new Date(a.end_time).getTime() > now)
    .sort((a, b) => a.start_time.localeCompare(b.start_time));
  const next = live[0];
  if (!next) return null;

  const started = new Date(next.start_time).getTime() <= now;
  const name = `${next.client?.first_name || ""} ${next.client?.last_name || ""}`.trim() || "לקוח";
  const phone = next.client?.phone || "";
  const after = live.length - 1;

  return (
    <section
      key={next.id}
      aria-label={started ? "בטיפול עכשיו" : "התור הבא"}
      className="m-print m-ticket rounded-xl bg-lime text-lime-ink border border-lime-edge overflow-visible"
    >
      <div className="flex items-stretch">
        <div className="flex-1 min-w-0 p-4 space-y-1">
          <div className="text-xs font-bold">
            {started ? "בטיפול עכשיו" : `התור הבא · ${inWords(minutesUntil(next.start_time, now))}`}
          </div>
          <div className="text-lg font-extrabold leading-tight truncate">{name}</div>
          <div className="text-sm font-medium leading-snug">{next.service?.name || "טיפול"}</div>
          <div className="text-xs font-semibold opacity-80">
            {after > 0 ? `ועוד ${after} ${after === 1 ? "תור" : "תורים"} היום` : "התור האחרון להיום"}
          </div>
        </div>
        <div className="flex flex-col items-center justify-center px-4 border-r-2 border-dashed border-lime-ink/25">
          <span className="text-3xl font-extrabold leading-none tracking-tight">{formatTime(next.start_time)}</span>
          <span className="text-xs font-semibold mt-1">עד {formatTime(next.end_time)}</span>
        </div>
      </div>
      {phone && (
        <div className="grid grid-cols-2 gap-2 px-4 pb-4">
          <a
            href={`https://wa.me/${toInternationalPhone(phone)}`}
            target="_blank"
            rel="noopener noreferrer"
            className="m-key h-11 rounded-lg bg-brand-600 text-white text-sm font-bold flex items-center justify-center gap-2"
          >
            <MessageCircle className="w-4 h-4 text-lime" />
            <span>וואטסאפ</span>
          </a>
          <a
            href={`tel:${phone}`}
            className="m-key2 h-11 rounded-lg bg-white border border-lime-edge text-ink-900 text-sm font-bold flex items-center justify-center gap-2"
          >
            <Phone className="w-4 h-4" />
            <span>חיוג</span>
          </a>
        </div>
      )}
    </section>
  );
}
