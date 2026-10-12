"use client";

import React, { useState } from "react";
import { Plus, Eye, EyeOff, Trash2, KeyRound, Power } from "lucide-react";
import { Service } from "@/lib/types";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Badge } from "@/components/ui/Badge";
import { Modal } from "@/components/ui/Modal";
import { formatPhone, triggerHaptic } from "@/lib/utils";
import { confirmDialog } from "@/lib/dialogs";

export interface TeamMember {
  id: string;
  name: string;
  phone: string;
  role: "manager" | "staff";
  is_visible_online: boolean;
  active: boolean;
  has_login: boolean;
}

interface EmployeesSectionProps {
  employees: TeamMember[];
  services?: Service[];
  businessId?: string;
  /** Each callback resolves to an error message, or null on success. */
  onAddEmployee: (input: {
    name: string;
    phone: string;
    role: "manager" | "staff";
    password?: string;
    is_visible_online: boolean;
  }) => Promise<string | null>;
  onUpdateEmployee: (
    id: string,
    patch: { is_visible_online?: boolean; active?: boolean; password?: string; remove_login?: boolean; role?: "manager" | "staff" }
  ) => Promise<string | null>;
  onDeleteEmployee: (id: string) => Promise<string | null>;
}

const PASSWORD_HINT = "לפחות 8 תווים, אות גדולה, אות קטנה, ספרה ותו מיוחד";

export const EmployeesSection: React.FC<EmployeesSectionProps> = ({
  employees,
  onAddEmployee,
  onUpdateEmployee,
  onDeleteEmployee,
}) => {
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [empName, setEmpName] = useState("");
  const [empPhone, setEmpPhone] = useState("");
  const [empRole, setEmpRole] = useState<"manager" | "staff">("staff");
  const [empVisible, setEmpVisible] = useState(true);
  const [empPassword, setEmpPassword] = useState("");
  const [formError, setFormError] = useState("");
  const [busy, setBusy] = useState(false);

  const [pwTarget, setPwTarget] = useState<TeamMember | null>(null);
  const [pwValue, setPwValue] = useState("");
  const [pwError, setPwError] = useState("");

  const [actionError, setActionError] = useState("");

  const resetForm = () => {
    setEmpName("");
    setEmpPhone("");
    setEmpRole("staff");
    setEmpVisible(true);
    setEmpPassword("");
    setFormError("");
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!empName.trim() || !empPhone.trim()) return;
    triggerHaptic(25);
    setBusy(true);
    setFormError("");
    const err = await onAddEmployee({
      name: empName.trim(),
      phone: empPhone.trim(),
      role: empRole,
      password: empPassword || undefined,
      is_visible_online: empVisible,
    });
    setBusy(false);
    if (err) {
      setFormError(err);
      return;
    }
    setIsAddModalOpen(false);
    resetForm();
  };

  const run = async (fn: () => Promise<string | null>) => {
    setActionError("");
    const err = await fn();
    if (err) setActionError(err);
  };

  const handleSetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!pwTarget) return;
    setBusy(true);
    setPwError("");
    const err = await onUpdateEmployee(pwTarget.id, { password: pwValue });
    setBusy(false);
    if (err) {
      setPwError(err);
      return;
    }
    setPwTarget(null);
    setPwValue("");
  };

  return (
    <div className="space-y-4">
      {/* Header bar */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 bg-white p-3.5 rounded-2xl border border-slate-200 shadow-xs">
        <div className="text-right">
          <h2 className="text-sm font-extrabold text-slate-900">ניהול צוות והרשאות</h2>
          <p className="text-xs text-slate-500 mt-0.5">
            הוסף עובדים עם כניסה אישית (טלפון + סיסמה). מנהל מנהל את העסק; עובד רואה את היומן והלקוחות בלבד.
          </p>
        </div>

        <Button
          size="sm"
          onClick={() => {
            triggerHaptic(15);
            resetForm();
            setIsAddModalOpen(true);
          }}
          className="shadow-xs whitespace-nowrap"
        >
          <Plus className="w-4 h-4 ml-1" />
          <span>הוסף עובד חדש</span>
        </Button>
      </div>

      {actionError && (
        <div className="rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-sm p-3 text-right">{actionError}</div>
      )}

      {employees.length === 0 && (
        <Card className="p-8 text-center text-sm text-slate-500 bg-white border border-dashed border-slate-300">
          עדיין לא הוספת עובדים. אחרי שתוסיף, תוכל לשייך להם תורים ולסנן את היומן לפי עובד.
        </Card>
      )}

      {/* Employees Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
        {employees.map((emp) => (
          <Card
            key={emp.id}
            className={`p-4 bg-white border border-slate-200/90 shadow-xs text-right space-y-3 ${emp.active ? "" : "opacity-60"}`}
          >
            <div className="flex items-start justify-between gap-2">
              <div className="flex items-center gap-2">
                <div className="w-10 h-10 rounded-2xl bg-indigo-600 text-white font-black flex items-center justify-center text-sm shadow-xs flex-shrink-0">
                  {emp.name[0]}
                </div>
                <button
                  type="button"
                  onClick={async () => {
                    triggerHaptic(20);
                    if (await confirmDialog(`האם אתה בטוח שברצונך למחוק את העובד "${emp.name}"?`, { confirmLabel: "למחוק", danger: true })) {
                      run(() => onDeleteEmployee(emp.id));
                    }
                  }}
                  className="p-1.5 text-ink-500 hover:text-rose-600 hover:bg-rose-50 rounded-xl transition-colors"
                  title="מחק עובד מהמערכת"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>

              <div className="flex-1 text-right">
                <div className="font-extrabold text-slate-900 text-sm flex items-center justify-end gap-1.5 flex-wrap">
                  <span>{emp.name}</span>
                  <Badge variant={emp.role === "manager" ? "secondary" : "default"} className="text-[10px]">
                    {emp.role === "manager" ? "מנהל" : "עובד"}
                  </Badge>
                  {!emp.active && (
                    <Badge variant="destructive" className="text-[10px]">
                      מושבת
                    </Badge>
                  )}
                </div>
                <div className="text-xs text-slate-500 font-mono mt-0.5" dir="ltr">
                  {formatPhone(emp.phone)}
                </div>
                <div className="text-[11px] mt-1 text-slate-500">
                  {emp.has_login ? "✓ יש כניסה אישית למערכת" : "ללא כניסה למערכת (שיוך תורים בלבד)"}
                </div>
              </div>
            </div>

            <div className="pt-2 border-t border-slate-100 flex flex-wrap items-center gap-2 text-xs">
              <button
                onClick={() => {
                  triggerHaptic(15);
                  run(() => onUpdateEmployee(emp.id, { is_visible_online: !emp.is_visible_online }));
                }}
                className={`flex items-center gap-1.5 px-2.5 py-1 rounded-xl font-bold transition-colors ${
                  emp.is_visible_online
                    ? "bg-emerald-50 text-emerald-700 border border-emerald-200 hover:bg-emerald-100"
                    : "bg-slate-100 text-slate-500 border border-slate-200 hover:bg-slate-200"
                }`}
                title="נראות בדף הזימון"
              >
                {emp.is_visible_online ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
                <span>{emp.is_visible_online ? "מוצג ללקוחות" : "מוסתר"}</span>
              </button>

              <button
                onClick={() => {
                  triggerHaptic(15);
                  setPwError("");
                  setPwValue("");
                  setPwTarget(emp);
                }}
                className="flex items-center gap-1.5 px-2.5 py-1 rounded-xl font-bold bg-indigo-50 text-indigo-700 border border-indigo-200 hover:bg-indigo-100 transition-colors"
              >
                <KeyRound className="w-3.5 h-3.5" />
                <span>{emp.has_login ? "שנה סיסמה" : "הגדר כניסה"}</span>
              </button>

              {emp.has_login && (
                <button
                  onClick={async () => {
                    if (await confirmDialog("להסיר את הכניסה של העובד למערכת?", { confirmLabel: "להסיר", danger: true })) {
                      run(() => onUpdateEmployee(emp.id, { remove_login: true }));
                    }
                  }}
                  className="px-2.5 py-1 rounded-xl font-bold text-slate-500 hover:text-rose-600 hover:bg-rose-50 transition-colors"
                >
                  הסר כניסה
                </button>
              )}

              <button
                onClick={() => run(() => onUpdateEmployee(emp.id, { active: !emp.active }))}
                className="flex items-center gap-1.5 px-2.5 py-1 rounded-xl font-bold bg-slate-100 text-slate-600 hover:bg-slate-200 transition-colors mr-auto"
                title="השבת / הפעל גישה"
              >
                <Power className="w-3.5 h-3.5" />
                <span>{emp.active ? "השבת" : "הפעל"}</span>
              </button>
            </div>
          </Card>
        ))}
      </div>

      {/* Add Employee Modal */}
      <Modal isOpen={isAddModalOpen} onClose={() => setIsAddModalOpen(false)} title="הוספת איש צוות חדש">
        <form onSubmit={handleCreate} className="space-y-3.5 text-right">
          <Input
            label="שם מלא *"
            placeholder="לדוגמה: רון שמעוני"
            value={empName}
            onChange={(e) => setEmpName(e.target.value)}
            required
          />

          <Input
            label="מספר טלפון נייד * (גם שם המשתמש לכניסה)"
            type="tel"
            placeholder="050-1234567"
            dir="ltr"
            className="text-right"
            value={empPhone}
            onChange={(e) => setEmpPhone(e.target.value)}
            required
          />

          <div>
            <label className="block text-sm font-semibold text-slate-700 mb-1">תפקיד והרשאה</label>
            <select
              value={empRole}
              onChange={(e) => setEmpRole(e.target.value as "manager" | "staff")}
              className="w-full h-11 rounded-2xl border border-slate-200 px-3 text-sm bg-white font-medium"
            >
              <option value="staff">עובד (יומן ולקוחות בלבד)</option>
              <option value="manager">מנהל (הכול חוץ מחשבון, סיסמה וצוות)</option>
            </select>
          </div>

          <Input
            label="סיסמת כניסה (אופציונלי)"
            type="password"
            dir="ltr"
            placeholder="השאר ריק אם אין צורך בכניסה"
            value={empPassword}
            onChange={(e) => setEmpPassword(e.target.value)}
            helperText={PASSWORD_HINT}
          />

          <div className="flex items-center justify-between p-3 rounded-2xl bg-slate-50 border border-slate-200">
            <span className="text-xs font-bold text-slate-700">הצג עובד זה בדף הזימון הציבורי של הלקוחות</span>
            <input
              type="checkbox"
              checked={empVisible}
              onChange={(e) => setEmpVisible(e.target.checked)}
              className="w-4 h-4 rounded text-indigo-600 focus:ring-indigo-500"
            />
          </div>

          {formError && <div className="rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-sm p-2.5">{formError}</div>}

          <div className="flex gap-2 pt-2">
            <Button type="button" variant="outline" className="flex-1" onClick={() => setIsAddModalOpen(false)}>
              ביטול
            </Button>
            <Button type="submit" className="flex-1" disabled={busy}>
              {busy ? "שומר..." : "שמור עובד"}
            </Button>
          </div>
        </form>
      </Modal>

      {/* Set / change password */}
      <Modal
        isOpen={Boolean(pwTarget)}
        onClose={() => setPwTarget(null)}
        title={pwTarget ? `כניסה למערכת: ${pwTarget.name}` : ""}
      >
        <form onSubmit={handleSetPassword} className="space-y-3.5 text-right">
          <p className="text-xs text-slate-500">
            העובד יתחבר עם מספר הטלפון שלו והסיסמה הזו, בדף הכניסה הרגיל של העסק.
          </p>
          <Input
            label="סיסמה חדשה *"
            type="password"
            dir="ltr"
            value={pwValue}
            onChange={(e) => setPwValue(e.target.value)}
            helperText={PASSWORD_HINT}
            required
          />
          {pwError && <div className="rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-sm p-2.5">{pwError}</div>}
          <div className="flex gap-2 pt-2">
            <Button type="button" variant="outline" className="flex-1" onClick={() => setPwTarget(null)}>
              ביטול
            </Button>
            <Button type="submit" className="flex-1" disabled={busy}>
              {busy ? "שומר..." : "שמור סיסמה"}
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
};
