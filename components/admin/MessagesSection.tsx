"use client";

import React from "react";
import { Megaphone } from "lucide-react";
import type { Business } from "@/lib/types";
import { Card } from "@/components/ui/Card";
import { SmsSettingsTab } from "@/components/admin/SmsSettingsTab";

interface MessagesSectionProps {
  business: Business;
  /** Saves business settings. Rejects when the save fails (the SMS settings show the reason). */
  onUpdateSettings: (updates: Partial<Business>) => Promise<void>;
}

/** The "Messages" tab: the confirmation SMS settings, and a note about what is coming. */
export function MessagesSection({ business, onUpdateSettings }: MessagesSectionProps) {
  return (
    <div className="space-y-4">
      <SmsSettingsTab business={business} onUpdateSettings={onUpdateSettings} />

      <Card className="p-5 text-right bg-white border border-slate-200 shadow-xs">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-2xl bg-ink-100 text-ink-600 flex items-center justify-center flex-shrink-0">
            <Megaphone className="w-5 h-5" aria-hidden="true" />
          </div>
          <div className="flex-1">
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-extrabold text-slate-900">וואטסאפ וקמפיינים</h3>
              <span className="text-[10px] px-1.5 rounded font-bold leading-4 bg-pending-100 text-pending-700">בקרוב</span>
            </div>
            <p className="mt-1.5 text-xs leading-relaxed text-ink-600">
              בקרוב תוכלו לשלוח הודעות לקהל הלקוחות שלכם, למשל עדכון על שעות מיוחדות או הזמנה לחזור, דרך וואטסאפ רשמי.
            </p>
            <p className="mt-1.5 text-xs leading-relaxed text-ink-600">
              זה שונה מהודעת האישור שלמעלה: האישור נשלח אוטומטית ללקוח שקבע תור, ואילו הודעות לקהל יישלחו רק כשתבחרו לשלוח אותן.
            </p>
          </div>
        </div>
      </Card>
    </div>
  );
}
