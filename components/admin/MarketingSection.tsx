"use client";

import React, { useState } from "react";
import {
  Megaphone,
  Send,
  MessageSquare,
  Smartphone,
} from "lucide-react";
import { MarketingMessage, Client } from "@/lib/types";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { triggerHaptic } from "@/lib/utils";

interface MarketingSectionProps {
  messages: MarketingMessage[];
  clients: Client[];
  businessName: string;
  businessSlug: string;
  onSendMessage?: (msg: MarketingMessage) => void;
}

export const MarketingSection: React.FC<MarketingSectionProps> = ({
  messages,
  clients,
  businessName,
  businessSlug,
}) => {
  const [channel, setChannel] = useState<"sms" | "whatsapp">("sms");
  const [audience, setAudience] = useState<"all" | "active" | "inactive">("all");
  const [content, setContent] = useState(
    `היי! 🌟 תזכורת חמה מ-${businessName}: מחכים לך לתור חדש! קביעת תור ישירה בלחיצה: ${typeof window !== "undefined" ? window.location.host : "tornow.app"}/${businessSlug}`
  );

  // Audience counts
  const targetCount = audience === "all" ? clients.length : Math.max(Math.round(clients.length * 0.6), 1);
  const quotaUsed = 24;
  const quotaTotal = 300;

  return (
    <div className="space-y-4">
      {/* "Coming Soon" Banner for Marketing SMS/WhatsApp as user instructed */}
      <div className="p-4 rounded-xl bg-brand-700 text-white relative overflow-hidden">
        <div className="relative z-10 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 text-right">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <span className="px-2.5 py-0.5 rounded-full text-[10px] font-extrabold bg-lime text-lime-ink">
                בקרוב - בהפעלה
              </span>
              <h2 className="text-base font-black text-white">מודול הודעות וקמפיינים (SMS & WhatsApp)</h2>
            </div>
            <p className="text-xs text-brand-100 leading-relaxed max-w-xl">
              עמוד ההודעות נמצא כעת בהרצה סגורה. חיבור שרתי ה-SMS וה-WhatsApp הישירים נמצא בהפעלה ויהיה זמין לשימוש מלא בעדכון הקרוב.
            </p>
          </div>
          <div className="flex items-center gap-2 bg-white/10 px-3 py-1.5 rounded-xl border border-white/15 text-xs font-bold whitespace-nowrap">
            <span>מצב הדגמה וסימולציה פעיל</span>
          </div>
        </div>
      </div>

      {/* Quota & Overview Card */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <Card className="p-4 bg-white border border-slate-200 shadow-xs text-right sm:col-span-2 space-y-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Megaphone className="w-5 h-5 text-indigo-600" />
              <h3 className="text-sm font-extrabold text-slate-900">חבילת הודעות שיווק ותזכורות</h3>
            </div>
            <span className="text-xs font-bold text-indigo-600 bg-indigo-50 px-2.5 py-0.5 rounded-full border border-indigo-100">
              {quotaUsed} / {quotaTotal} נוצלו החודש
            </span>
          </div>

          <div className="w-full h-2.5 bg-slate-100 rounded-full overflow-hidden">
            <div
              className="h-full bg-brand-600 rounded-full transition-all"
              style={{ width: `${Math.round((quotaUsed / quotaTotal) * 100)}%` }}
            />
          </div>

          <div className="flex items-center justify-between text-[11px] text-ink-500 font-medium">
            <span>נותרו עוד {quotaTotal - quotaUsed} הודעות בחבילה</span>
            <span>מתאפס ב-1 לכל חודש</span>
          </div>
        </Card>

        <Card className="p-4 bg-white border border-slate-200 shadow-xs text-right flex flex-col justify-center">
          <div className="text-xs text-ink-500 font-medium">נמענים זמינים במאגר</div>
          <div className="text-2xl font-black text-slate-900 mt-1">{clients.length}</div>
          <div className="text-[11px] text-emerald-600 font-bold mt-0.5">כל הלקוחות עם מספר נייד תקין</div>
        </Card>
      </div>

      {/* Campaign Sender */}
      <Card className="p-5 bg-white border border-slate-200 shadow-xs text-right space-y-4">
        <div className="border-b border-slate-100 pb-3 flex items-center justify-between">
          <h3 className="text-sm font-extrabold text-slate-900">יצירת קמפיין הודעות תפוצה</h3>
          <span className="text-xs font-bold text-amber-600 bg-amber-50 px-2.5 py-0.5 rounded-full border border-amber-200">
            תצוגת סימולציה בלבד (השליחה נעולה)
          </span>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 space-y-3.5">
            {/* Channel Selection */}
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1.5">ערוץ שליחה</label>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => {
                    triggerHaptic(10);
                    setChannel("sms");
                  }}
                  className={`flex items-center justify-center gap-2 py-2.5 px-3 rounded-xl border text-xs font-bold transition-all ${
                    channel === "sms"
                      ? "bg-indigo-50 border-indigo-600 text-indigo-700"
                      : "bg-white border-slate-200 text-slate-600 hover:bg-slate-50"
                  }`}
                >
                  <MessageSquare className="w-4 h-4" />
                  <span>SMS רגיל</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    triggerHaptic(10);
                    setChannel("whatsapp");
                  }}
                  className={`flex items-center justify-center gap-2 py-2.5 px-3 rounded-xl border text-xs font-bold transition-all ${
                    channel === "whatsapp"
                      ? "bg-emerald-50 border-emerald-600 text-emerald-700"
                      : "bg-white border-slate-200 text-slate-600 hover:bg-slate-50"
                  }`}
                >
                  <Smartphone className="w-4 h-4" />
                  <span>וואטסאפ (רשמי)</span>
                </button>
              </div>
            </div>

            {/* Audience Segment */}
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1.5">קהל יעד</label>
              <select
                value={audience}
                onChange={(e) => setAudience(e.target.value as any)}
                className="w-full h-10 rounded-xl border border-slate-200 px-3 text-xs bg-white font-medium"
              >
                <option value="all">כלל הלקוחות הרשומים ({clients.length} לקוחות)</option>
                <option value="active">לקוחות שביקרו ב-30 הימים האחרונים ({targetCount})</option>
                <option value="inactive">לקוחות שלא ביקרו מעל חודשיים ({targetCount})</option>
              </select>
            </div>

            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="text-xs font-bold text-slate-700">תוכן ההודעה</label>
                <span className="text-[11px] text-ink-500 font-mono">
                  {content.length} תווים • {Math.ceil(content.length / 70)} חלקי SMS
                </span>
              </div>
              <textarea
                rows={4}
                value={content}
                onChange={(e) => setContent(e.target.value)}
                className="w-full p-3 rounded-xl border border-slate-200 text-xs text-right focus:outline-none focus:ring-2 focus:ring-indigo-500/20 leading-relaxed font-medium"
                placeholder="הקלד כאן את תוכן ההודעה..."
              />
            </div>

            <div className="p-3 bg-amber-50/70 text-amber-900 text-xs rounded-xl border border-amber-200 flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-amber-500 animate-pulse flex-shrink-0" />
              <span>עמוד זה נמצא כרגע בתצוגת הדגמה בלבד. שליחת הודעות בפועל תהיה זמינה בקרוב.</span>
            </div>

            <Button
              disabled
              className="w-full shadow-xs opacity-75 cursor-not-allowed bg-slate-300 text-slate-600 border border-slate-300 hover:bg-slate-300"
              size="lg"
            >
              <Send className="w-4 h-4 ml-2" />
              <span>שדר קמפיין ל-{targetCount} נמענים</span>
            </Button>
          </div>

          {/* Live Mobile Preview */}
          <div className="flex flex-col items-center justify-center p-4 bg-slate-50 rounded-2xl border border-slate-200">
            <div className="text-[11px] font-bold text-ink-500 mb-2">תצוגה מקדימה במכשיר הלקוח:</div>
            <div className="w-64 bg-white rounded-3xl p-3 shadow-md border border-slate-200 space-y-2">
              <div className="flex items-center justify-between text-[10px] text-ink-500 border-b border-slate-100 pb-1.5">
                <span className="font-bold text-slate-700">{businessName}</span>
                <span>עכשיו</span>
              </div>
              <div className="p-2.5 rounded-2xl bg-indigo-50/70 text-[11px] text-slate-800 text-right leading-relaxed font-medium">
                {content || "תוכן ההודעה יופיע כאן..."}
              </div>
            </div>
          </div>
        </div>
      </Card>

      {/* Messages History Log */}
      <Card className="p-5 bg-white border border-slate-200 shadow-xs text-right space-y-3">
        <h3 className="text-sm font-extrabold text-slate-900 border-b border-slate-100 pb-2.5">
          היסטוריית הודעות שנשלחו
        </h3>

        <div className="space-y-2">
          {messages.map((msg) => (
            <div
              key={msg.id}
              className="flex items-center justify-between p-3 rounded-xl border border-slate-100 bg-slate-50/60 text-xs"
            >
              <div className="flex items-center gap-2">
                <Badge variant="success" className="text-[10px]">
                  נמסר ({msg.recipient_count} נמענים)
                </Badge>
                <span className="text-ink-500 text-[11px] font-mono">{msg.sent_at}</span>
              </div>
              <div className="text-right max-w-sm truncate font-medium text-slate-700">
                {msg.content}
              </div>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
};
