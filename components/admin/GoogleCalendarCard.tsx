"use client";

import React, { useCallback, useEffect, useState } from "react";
import { CalendarCheck2, CalendarX2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { alertDialog, confirmDialog } from "@/lib/dialogs";
import { triggerHaptic } from "@/lib/utils";
import { startGoogleCalendarConnect, type CalendarStatusDto } from "@/lib/google-calendar-client";

interface Props {
  role: "owner" | "manager" | "staff";
}

/** Direct, instant connection to the owner's Google Calendar (settings > calendar sync). */
export const GoogleCalendarCard: React.FC<Props> = ({ role }) => {
  const [status, setStatus] = useState<CalendarStatusDto | null>(null);
  const [busy, setBusy] = useState<"connect" | "disconnect" | "retry" | null>(null);
  const isOwner = role === "owner";

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/google-calendar/status");
      if (res.ok) setStatus(await res.json());
    } catch {
      // keep the previous state
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/google-calendar/status")
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!cancelled && data) setStatus(data);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  const connect = async () => {
    triggerHaptic(20);
    setBusy("connect");
    const result = await startGoogleCalendarConnect();
    if (!result.ok) {
      setBusy(null);
      await alertDialog(result.error);
    }
    // on success the browser is on its way to Google
  };

  const disconnect = async () => {
    const ok = await confirmDialog(
      "התורים החדשים יפסיקו להתעדכן ביומן Google שלך. אפשר לחבר שוב בכל רגע.",
      { title: "לנתק את יומן Google?", confirmLabel: "לנתק" }
    );
    if (!ok) return;
    const deleteCalendar = await confirmDialog(
      "למחוק גם את היומן \"TorNow – תורים\" מחשבון Google, יחד עם כל התורים שבו? אם לא, הוא יישאר ויהיה אפשר למחוק אותו ידנית.",
      { title: "מה לעשות עם היומן?", confirmLabel: "למחוק גם את היומן", cancelLabel: "להשאיר אותו" }
    );
    setBusy("disconnect");
    try {
      const res = await fetch("/api/google-calendar/disconnect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ delete_calendar: deleteCalendar }),
      });
      if (!res.ok) throw new Error("failed");
      await load();
    } catch {
      await alertDialog("לא הצלחנו לנתק את היומן. נסו שוב.");
    } finally {
      setBusy(null);
    }
  };

  const retry = async () => {
    setBusy("retry");
    try {
      const res = await fetch("/api/google-calendar/retry", { method: "POST" });
      if (!res.ok) throw new Error("failed");
      setStatus(await res.json());
    } catch {
      await alertDialog("לא הצלחנו לנסות שוב. נסו בעוד רגע.");
    } finally {
      setBusy(null);
    }
  };

  if (!status) return null;

  const notConfigured = !status.configured;

  return (
    <Card className="p-4 bg-white border border-slate-200 space-y-3 text-right">
      <div className="flex items-start gap-3">
        <div
          className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 ${
            status.connected ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-500"
          }`}
        >
          {status.connected ? <CalendarCheck2 className="w-5 h-5" /> : <CalendarX2 className="w-5 h-5" />}
        </div>
        <div className="flex-1">
          <h4 className="text-sm font-extrabold text-slate-900">חיבור ישיר ליומן גוגל (מיידי)</h4>
          <p className="text-xs text-slate-500 leading-relaxed mt-0.5">
            כל תור שנקבע, משתנה או מבוטל מופיע ביומן הגוגל שלך תוך שניות, כולל באפליקציה בטלפון. נוצר יומן נפרד בשם
            &quot;TorNow – תורים&quot;, והיומן האישי שלך לא נפגע.
          </p>
        </div>
      </div>

      {status.connected && (
        <div className="rounded-xl bg-emerald-50 border border-emerald-200 px-3 py-2 text-xs text-emerald-900">
          מחובר כ-<strong dir="ltr">{status.email}</strong>
          {status.pendingCount > 0 && <span> · {status.pendingCount} תורים בסנכרון</span>}
        </div>
      )}

      {status.needsReconnect && (
        <div className="rounded-xl bg-amber-50 border border-amber-200 px-3 py-2 text-xs text-amber-900">
          החיבור ליומן Google פג או בוטל. תורים חדשים לא מגיעים ליומן עד שמחברים מחדש.
        </div>
      )}

      {status.failedCount > 0 && (
        <div className="rounded-xl bg-rose-50 border border-rose-200 px-3 py-2 text-xs text-rose-900">
          {status.failedCount} תורים לא סונכרנו ליומן Google.
        </div>
      )}

      {notConfigured && (
        <div className="rounded-xl bg-slate-50 border border-slate-200 px-3 py-2 text-xs text-slate-600">
          החיבור הישיר עוד לא הופעל במערכת. בינתיים אפשר להשתמש בחיבור דרך קישור, למטה.
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        {isOwner && !status.connected && !status.needsReconnect && (
          <Button type="button" onClick={connect} disabled={busy !== null || notConfigured} className="min-h-[44px]">
            {busy === "connect" ? "פותח את Google..." : "חבר יומן Google"}
          </Button>
        )}
        {isOwner && status.needsReconnect && (
          <Button type="button" onClick={connect} disabled={busy !== null || notConfigured} className="min-h-[44px]">
            {busy === "connect" ? "פותח את Google..." : "חבר מחדש"}
          </Button>
        )}
        {status.failedCount > 0 && (status.connected || status.needsReconnect) && (
          <Button type="button" variant="outline" onClick={retry} disabled={busy !== null} className="min-h-[44px]">
            <RefreshCw className="w-4 h-4 ml-1.5" />
            <span>{busy === "retry" ? "מנסה..." : "נסה שוב"}</span>
          </Button>
        )}
        {isOwner && (status.connected || status.needsReconnect) && (
          <Button type="button" variant="outline" onClick={disconnect} disabled={busy !== null} className="min-h-[44px]">
            {busy === "disconnect" ? "מנתק..." : "נתק"}
          </Button>
        )}
      </div>
      {!isOwner && !status.connected && !status.needsReconnect && (
        <p className="text-[11px] text-slate-500">רק בעל העסק יכול לחבר את היומן.</p>
      )}
    </Card>
  );
};
