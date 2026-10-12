"use client";

import React, { useState } from "react";
import { Lock, Plus } from "lucide-react";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { Input } from "@/components/ui/Input";
import { triggerHaptic } from "@/lib/utils";

interface CashRegisterSectionProps {
  todayRevenue: number;
  confirmedAppointmentsCount: number;
}

export const CashRegisterSection: React.FC<CashRegisterSectionProps> = ({
  todayRevenue,
  confirmedAppointmentsCount,
}) => {
  const [manualReceipts, setManualReceipts] = useState([
    { id: "rc-1", client: "אבי כהן", service: "תספורת גברים + זקן", amount: 100, method: "מזומן", time: "10:45" },
    { id: "rc-2", client: "רועי מזרחי", service: "תספורת גברים", amount: 70, method: "ביט (ידני)", time: "11:30" },
    { id: "rc-3", client: "ירון לוי", service: "עיצוב זקן", amount: 40, method: "מזומן", time: "12:15" },
  ]);

  const [clientName, setClientName] = useState("");
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState("מזומן");
  const [isAdding, setIsAdding] = useState(false);

  const handleAddManualReceipt = (e: React.FormEvent) => {
    e.preventDefault();
    if (!clientName.trim() || !amount) return;

    triggerHaptic(20);
    const newR = {
      id: "rc-" + Math.random().toString(36).substring(2, 7),
      client: clientName.trim(),
      service: "תשלום בדלפק",
      amount: Number(amount),
      method,
      time: new Date().toLocaleTimeString("he-IL", { hour: "2-digit", minute: "2-digit" }),
    };

    setManualReceipts([newR, ...manualReceipts]);
    setClientName("");
    setAmount("");
    setIsAdding(false);
  };

  const totalReceipts = manualReceipts.reduce((sum, r) => sum + r.amount, 0);

  return (
    <div className="space-y-4">
      {/* "Coming Soon" Banner for Credit Card Terminals as user instructed */}
      <div className="p-4 rounded-xl bg-brand-700 text-white relative overflow-hidden">
        <div className="relative z-10 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 text-right">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <span className="px-2.5 py-0.5 rounded-full text-[10px] font-extrabold bg-lime text-lime-ink">
                בקרוב - בהפעלה
              </span>
              <h2 className="text-base font-black">מודול סליקה וקופה דיגיטלית</h2>
            </div>
            <p className="text-xs text-indigo-200 max-w-xl leading-relaxed">
              חיבור מהיר למסופי אשראי, סליקת מקדמות אונליין, Apple Pay, Bit והפקת חשבוניות מס ירוקות אוטומטיות.
              המודול כרגע אינו פעיל ומיועד להפעלה בשלב הבא.
            </p>
          </div>

          <div className="flex items-center gap-2 flex-shrink-0">
            <div className="px-3 py-1.5 rounded-xl bg-white/10 text-xs font-bold text-indigo-200 border border-white/10 flex items-center gap-1.5">
              <Lock className="w-3.5 h-3.5" />
              <span>סליקה מושבתת כעת</span>
            </div>
          </div>
        </div>

        {/* Decorative background glow */}
        <div className="absolute top-0 right-0 w-48 h-48 bg-indigo-500/20 rounded-full blur-3xl pointer-events-none" />
      </div>

      {/* Register Summary Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <Card className="p-4 bg-white border border-slate-200 shadow-xs text-right">
          <div className="text-xs text-ink-500 font-medium">סך תקבולים ידניים היום</div>
          <div className="text-2xl font-black text-slate-900 mt-1">₪{totalReceipts}</div>
          <div className="text-[11px] text-emerald-600 font-bold mt-0.5">{manualReceipts.length} עסקאות נרשמו</div>
        </Card>

        <Card className="p-4 bg-white border border-slate-200 shadow-xs text-right">
          <div className="text-xs text-ink-500 font-medium">הכנסה משוערת מהתורים היום</div>
          <div className="text-2xl font-black text-indigo-600 mt-1">₪{todayRevenue}</div>
          <div className="text-[11px] text-slate-500 font-medium mt-0.5">{confirmedAppointmentsCount} תורים מתוזמנים</div>
        </Card>

        <Card className="p-4 bg-white border border-slate-200 shadow-xs text-right flex flex-col justify-center">
          <Button
            size="sm"
            onClick={() => {
              triggerHaptic(15);
              setIsAdding(!isAdding);
            }}
            className="w-full"
          >
            <Plus className="w-4 h-4 ml-1" />
            <span>רישום קבלת תשלום ידנית</span>
          </Button>
        </Card>
      </div>

      {/* Manual Payment Entry Form */}
      {isAdding && (
        <Card className="p-4 bg-white border border-indigo-200 shadow-xs text-right animate-in fade-in duration-200">
          <h4 className="text-xs font-bold text-slate-900 mb-3">רישום תקבול מהדלפק (מזומן / ביט)</h4>
          <form onSubmit={handleAddManualReceipt} className="grid grid-cols-1 sm:grid-cols-4 gap-3 items-end">
            <Input
              label="שם הלקוח *"
              placeholder="שם הלקוח"
              value={clientName}
              onChange={(e) => setClientName(e.target.value)}
              required
            />
            <Input
              label="סכום (₪) *"
              type="number"
              placeholder="80"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              required
            />
            <div>
              <label className="block text-sm font-semibold text-slate-700 mb-1">אמצעי תשלום</label>
              <select
                value={method}
                onChange={(e) => setMethod(e.target.value)}
                className="w-full h-11 rounded-2xl border border-slate-200 px-3 text-xs bg-white font-medium"
              >
                <option value="מזומן">מזומן בדלפק</option>
                <option value="ביט (ידני)">העברת Bit ידנית</option>
                <option value="העברה בנקאית">העברה בנקאית</option>
              </select>
            </div>
            <Button type="submit" className="h-11">
              רשום תשלום
            </Button>
          </form>
        </Card>
      )}

      {/* Receipts Log */}
      <Card className="p-5 bg-white border border-slate-200 shadow-xs text-right space-y-3">
        <div className="flex items-center justify-between border-b border-slate-100 pb-2.5">
          <h3 className="text-sm font-extrabold text-slate-900">יומן עסקאות ותקבולים להיום</h3>
          <span className="text-xs text-ink-500 font-mono">{new Date().toLocaleDateString("he-IL")}</span>
        </div>

        <div className="space-y-2">
          {manualReceipts.map((rc) => (
            <div
              key={rc.id}
              className="flex items-center justify-between p-3 rounded-xl border border-slate-100 bg-slate-50/60 text-xs"
            >
              <div className="flex items-center gap-2">
                <span className="text-sm font-extrabold text-slate-900 font-mono">₪{rc.amount}</span>
                <Badge variant="default" className="text-[10px]">
                  {rc.method}
                </Badge>
              </div>

              <div className="text-right">
                <div className="font-bold text-slate-800">{rc.client}</div>
                <div className="text-[11px] text-ink-500">{rc.service} • {rc.time}</div>
              </div>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
};
