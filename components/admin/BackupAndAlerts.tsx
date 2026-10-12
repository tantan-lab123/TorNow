"use client";

import React, { useEffect, useState } from "react";
import { BellRing, Download, FileSpreadsheet, ShieldCheck } from "lucide-react";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";

type PushState = "unsupported" | "off" | "on" | "denied" | "busy";

function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const raw = atob((base64 + padding).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

/** Data export / backup downloads + free browser notifications for new appointments. */
export const BackupAndAlerts: React.FC = () => {
  const [push, setPush] = useState<PushState>("off");
  const [error, setError] = useState("");

  useEffect(() => {
    // Browser-only capability checks (they do not exist on the server), so they run after mount
    /* eslint-disable react-hooks/set-state-in-effect */
    if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) {
      setPush("unsupported");
      return;
    }
    if (Notification.permission === "denied") {
      setPush("denied");
      return;
    }
    navigator.serviceWorker
      .getRegistration("/sw.js")
      .then((reg) => reg?.pushManager.getSubscription())
      .then((sub) => setPush(sub ? "on" : "off"))
      .catch(() => setPush("off"));
    /* eslint-enable react-hooks/set-state-in-effect */
  }, []);

  const enable = async () => {
    setError("");
    setPush("busy");
    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setPush(permission === "denied" ? "denied" : "off");
        return;
      }
      const reg = await navigator.serviceWorker.register("/sw.js");
      await navigator.serviceWorker.ready;
      const keyRes = await fetch("/api/push");
      if (!keyRes.ok) throw new Error("key");
      const { publicKey } = await keyRes.json();
      const sub =
        (await reg.pushManager.getSubscription()) ||
        (await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(publicKey) as BufferSource,
        }));
      const res = await fetch("/api/push", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(sub.toJSON()),
      });
      if (!res.ok) throw new Error("save");
      setPush("on");
    } catch {
      setError("לא הצלחנו להפעיל התראות במכשיר הזה.");
      setPush("off");
    }
  };

  const disable = async () => {
    setPush("busy");
    try {
      const reg = await navigator.serviceWorker.getRegistration("/sw.js");
      const sub = await reg?.pushManager.getSubscription();
      if (sub) {
        await fetch("/api/push", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ endpoint: sub.endpoint }),
        });
        await sub.unsubscribe();
      }
    } finally {
      setPush("off");
    }
  };

  return (
    <div className="space-y-4 mt-6">
      <Card className="p-5 bg-white border border-slate-200 shadow-xs text-right space-y-3">
        <div className="flex items-center gap-2">
          <BellRing className="w-5 h-5 text-indigo-600" />
          <h3 className="text-sm font-extrabold text-slate-900">התראות על תורים חדשים (בחינם)</h3>
        </div>
        <p className="text-xs text-slate-500 leading-relaxed">
          קבל התראה בטלפון או במחשב כשלקוח קובע, מבטל או משנה תור, או מצטרף לרשימת ההמתנה. ההגדרה היא לכל מכשיר בנפרד.
          באייפון צריך קודם להוסיף את האתר למסך הבית.
        </p>
        {push === "unsupported" && (
          <p className="text-xs font-bold text-amber-700">הדפדפן הזה לא תומך בהתראות.</p>
        )}
        {push === "denied" && (
          <p className="text-xs font-bold text-amber-700">ההתראות חסומות בדפדפן. אפשר לאפשר אותן בהגדרות האתר.</p>
        )}
        {(push === "off" || push === "busy") && (
          <Button type="button" onClick={enable} disabled={push === "busy"} size="sm">
            {push === "busy" ? "מפעיל..." : "הפעל התראות במכשיר הזה"}
          </Button>
        )}
        {push === "on" && (
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-bold text-emerald-700 inline-flex items-center gap-1">
              <ShieldCheck className="w-4 h-4" /> התראות פעילות במכשיר הזה
            </span>
            <Button type="button" variant="outline" size="sm" onClick={disable}>
              כבה
            </Button>
          </div>
        )}
        {error && <p className="text-xs font-bold text-rose-600">{error}</p>}
      </Card>

      <Card className="p-5 bg-white border border-slate-200 shadow-xs text-right space-y-3">
        <div className="flex items-center gap-2">
          <Download className="w-5 h-5 text-indigo-600" />
          <h3 className="text-sm font-extrabold text-slate-900">גיבוי וייצוא נתונים</h3>
        </div>
        <p className="text-xs text-slate-500 leading-relaxed">
          הורד עותק מלא של הנתונים שלך: תורים, לקוחות, שירותים והגדרות. הקובץ לא כולל סיסמאות.
        </p>
        <div className="flex flex-wrap gap-2">
          <a
            href="/api/export?format=json"
            download
            className="inline-flex items-center gap-1.5 h-11 px-4 rounded-xl bg-indigo-600 text-white text-xs font-bold hover:bg-indigo-700"
          >
            <Download className="w-4 h-4" /> גיבוי מלא (JSON)
          </a>
          <a
            href="/api/export?format=appointments"
            download
            className="inline-flex items-center gap-1.5 h-11 px-4 rounded-xl bg-slate-100 text-slate-800 text-xs font-bold hover:bg-slate-200 border border-slate-200"
          >
            <FileSpreadsheet className="w-4 h-4 text-emerald-600" /> תורים (Excel)
          </a>
          <a
            href="/api/export?format=clients"
            download
            className="inline-flex items-center gap-1.5 h-11 px-4 rounded-xl bg-slate-100 text-slate-800 text-xs font-bold hover:bg-slate-200 border border-slate-200"
          >
            <FileSpreadsheet className="w-4 h-4 text-emerald-600" /> לקוחות (Excel)
          </a>
        </div>
      </Card>
    </div>
  );
};
