"use client";

import React, { useState } from "react";
import {
  Clock,
  Palmtree,
  Plus,
  Trash2,
  Check,
} from "lucide-react";
import { Business, WorkingHours, DayOfWeek, DateOverride } from "@/lib/types";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";
import { formatDayString, triggerHaptic } from "@/lib/utils";

interface WorkScheduleSectionProps {
  business: Business;
  workingHours: WorkingHours;
  onUpdateWorkingHours: (hours: WorkingHours) => Promise<void>;
  dateOverrides: DateOverride[];
  onAddOverride: (override: DateOverride) => Promise<void>;
  onDeleteOverride: (overrideId: string) => Promise<void>;
}

const HEBREW_DAYS: Record<DayOfWeek, string> = {
  sunday: "יום ראשון",
  monday: "יום שני",
  tuesday: "יום שלישי",
  wednesday: "יום רביעי",
  thursday: "יום חמישי",
  friday: "יום שישי",
  saturday: "יום שבת",
};

const DAYS_ORDER: DayOfWeek[] = [
  "sunday",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
];

export const WorkScheduleSection: React.FC<WorkScheduleSectionProps> = ({
  business,
  workingHours,
  onUpdateWorkingHours,
  dateOverrides,
  onAddOverride,
  onDeleteOverride,
}) => {
  const [subTab, setSubTab] = useState<"hours" | "holidays">("hours");
  const [hoursState, setHoursState] = useState<WorkingHours>(workingHours);
  const [isSavingHours, setIsSavingHours] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);

  // Holiday Modal State
  const [isHolidayModalOpen, setIsHolidayModalOpen] = useState(false);
  const [holidayDate, setHolidayDate] = useState("");
  const [holidayReason, setHolidayReason] = useState("חג / יום שבתון");

  const handleSaveHours = async () => {
    setIsSavingHours(true);
    triggerHaptic(20);
    try {
      await onUpdateWorkingHours(hoursState);
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 2500);
    } finally {
      setIsSavingHours(false);
    }
  };

  const handleAddHoliday = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!holidayDate) return;

    triggerHaptic(25);
    const newOverride: DateOverride = {
      id: "ovr-" + Math.random().toString(36).substring(2, 9),
      date: holidayDate,
      is_closed: true,
      reason: holidayReason.trim() || "סגור לרגל חג / חופשה",
    };

    await onAddOverride(newOverride);
    setIsHolidayModalOpen(false);
    setHolidayDate("");
  };

  return (
    <div className="space-y-4">
      {/* Sub-nav control */}
      <div className="flex bg-slate-200/80 p-1 rounded-2xl max-w-sm mx-auto">
        <button
          onClick={() => setSubTab("hours")}
          className={`flex-1 min-h-[44px] rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-1.5 ${
            subTab === "hours" ? "bg-white text-indigo-600 shadow-xs" : "text-slate-600 hover:text-slate-900"
          }`}
        >
          <Clock className="w-4 h-4" />
          <span>שעות פתיחה שבועיות</span>
        </button>

        <button
          onClick={() => setSubTab("holidays")}
          className={`flex-1 min-h-[44px] rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-1.5 ${
            subTab === "holidays" ? "bg-white text-indigo-600 shadow-xs" : "text-slate-600 hover:text-slate-900"
          }`}
        >
          <Palmtree className="w-4 h-4" />
          <span>חגים וחופשות ({dateOverrides.length})</span>
        </button>
      </div>

      {/* 1. WEEKLY HOURS */}
      {subTab === "hours" && (
        <Card className="p-5 bg-white border border-slate-200 shadow-xs text-right space-y-4">
          <div className="flex items-center justify-between border-b border-slate-100 pb-3">
            <div>
              <h3 className="text-sm font-extrabold text-slate-900">שעות פעילות קבועות לפי ימי השבוע</h3>
              <p className="text-xs text-ink-500 mt-0.5">קבע זמני פתיחה וסגירה או סמן יום כסגור</p>
            </div>
            <Button
              onClick={handleSaveHours}
              isLoading={isSavingHours}
              size="sm"
              className="shadow-xs"
            >
              {saveSuccess ? <Check className="w-4 h-4 ml-1" /> : null}
              <span>{saveSuccess ? "נשמר בהצלחה!" : "שמור שעות"}</span>
            </Button>
          </div>

          <div className="space-y-2.5">
            {DAYS_ORDER.map((day) => {
              const current = hoursState[day] || { active: true, open: "09:00", close: "19:00" };

              return (
                <div
                  key={day}
                  className={`p-3 rounded-2xl border transition-all flex flex-col sm:flex-row sm:flex-wrap items-start sm:items-center justify-between gap-3 ${
                    current.active ? "bg-white border-slate-200" : "bg-slate-50 border-slate-200/60"
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <input
                      type="checkbox"
                      aria-label={`פתוח ב${HEBREW_DAYS[day]}`}
                      checked={current.active}
                      onChange={(e) => {
                        setHoursState({
                          ...hoursState,
                          [day]: { ...current, active: e.target.checked },
                        });
                      }}
                      className="w-4 h-4 rounded text-indigo-600 focus:ring-indigo-500"
                    />
                    <span className="text-xs font-extrabold text-slate-800 w-24">
                      {HEBREW_DAYS[day]}
                    </span>
                    {!current.active && (
                      <span className="text-[10px] font-bold text-rose-600 bg-rose-50 px-2 py-0.5 rounded-md border border-rose-100">
                        סגור
                      </span>
                    )}
                  </div>

                  {current.active && (
                    <div className="flex items-center gap-2 text-xs">
                      <span className="text-ink-500">פתיחה:</span>
                      <input
                        type="time"
                        aria-label={`שעת פתיחה, ${HEBREW_DAYS[day]}`}
                        value={current.open}
                        onChange={(e) => {
                          setHoursState({
                            ...hoursState,
                            [day]: { ...current, open: e.target.value },
                          });
                        }}
                        className="px-2 py-1 rounded-xl border border-slate-200 bg-slate-50 font-mono text-xs text-center"
                      />
                      <span className="text-ink-500">עד:</span>
                      <input
                        type="time"
                        aria-label={`שעת סגירה, ${HEBREW_DAYS[day]}`}
                        value={current.close}
                        onChange={(e) => {
                          setHoursState({
                            ...hoursState,
                            [day]: { ...current, close: e.target.value },
                          });
                        }}
                        className="px-2 py-1 rounded-xl border border-slate-200 bg-slate-50 font-mono text-xs text-center"
                      />
                    </div>
                  )}

                  {current.active && (
                    <div className="basis-full flex flex-wrap items-center gap-2 border-t border-slate-100 pt-2.5 text-xs">
                      <label className="flex items-center gap-2 font-bold text-slate-700">
                        <input
                          type="checkbox"
                          checked={!!current.lunch_break?.active}
                          onChange={(e) => {
                            const lb = current.lunch_break;
                            setHoursState({
                              ...hoursState,
                              [day]: {
                                ...current,
                                lunch_break: {
                                  start: lb?.start || "13:00",
                                  end: lb?.end || "14:00",
                                  active: e.target.checked,
                                },
                              },
                            });
                          }}
                          className="w-4 h-4 rounded text-indigo-600 focus:ring-indigo-500"
                        />
                        <span>הפסקה (בלי תורים)</span>
                      </label>
                      {current.lunch_break?.active ? (
                        <>
                          <span className="text-ink-500">מ:</span>
                          <input
                            type="time"
                            aria-label={`תחילת הפסקה, ${HEBREW_DAYS[day]}`}
                            value={current.lunch_break.start}
                            onChange={(e) => {
                              setHoursState({
                                ...hoursState,
                                [day]: { ...current, lunch_break: { ...current.lunch_break!, start: e.target.value } },
                              });
                            }}
                            className="px-2 py-1 rounded-xl border border-slate-200 bg-slate-50 font-mono text-xs text-center"
                          />
                          <span className="text-ink-500">עד:</span>
                          <input
                            type="time"
                            aria-label={`סוף הפסקה, ${HEBREW_DAYS[day]}`}
                            value={current.lunch_break.end}
                            onChange={(e) => {
                              setHoursState({
                                ...hoursState,
                                [day]: { ...current, lunch_break: { ...current.lunch_break!, end: e.target.value } },
                              });
                            }}
                            className="px-2 py-1 rounded-xl border border-slate-200 bg-slate-50 font-mono text-xs text-center"
                          />
                        </>
                      ) : (
                        <span className="text-ink-500">אין הפסקה ביום הזה</span>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </Card>
      )}

      {/* 2. HOLIDAYS & OVERRIDES */}
      {subTab === "holidays" && (
        <Card className="p-5 bg-white border border-slate-200 shadow-xs text-right space-y-4">
          <div className="flex items-center justify-between border-b border-slate-100 pb-3">
            <div>
              <h3 className="text-sm font-extrabold text-slate-900">חגים, מועדים וחסימות תאריכים מראש</h3>
              <p className="text-xs text-ink-500 mt-0.5">חסימת ימים ספציפיים מלקבוע בהם תורים ביומן</p>
            </div>
            <Button
              size="sm"
              onClick={() => {
                triggerHaptic(15);
                setIsHolidayModalOpen(true);
              }}
              className="shadow-xs"
            >
              <Plus className="w-4 h-4 ml-1" />
              <span>הוסף יום חופשה / חג</span>
            </Button>
          </div>

          <div className="space-y-2">
            {dateOverrides.length === 0 ? (
              <div className="text-center py-8 text-xs text-ink-500">
                אין חופשות או חגים מוגדרים כרגע. לחץ על הכפתור למעלה כדי לחסום תאריך.
              </div>
            ) : (
              dateOverrides.map((ovr) => (
                <div
                  key={ovr.id}
                  className="flex items-center justify-between p-3 rounded-xl border border-slate-100 bg-slate-50 text-xs"
                >
                  <button
                    onClick={() => onDeleteOverride(ovr.id)}
                    className="h-11 w-11 inline-flex items-center justify-center rounded-lg text-rose-500 hover:bg-rose-50 transition-colors"
                    title="מחק חופשה זו"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>

                  <div className="text-right">
                    <div className="font-extrabold text-slate-800">{ovr.reason}</div>
                    <div className="text-[11px] text-slate-500 mt-0.5">{formatDayString(ovr.date)}</div>
                  </div>
                </div>
              ))
            )}
          </div>
        </Card>
      )}

      {/* Add Holiday Modal */}
      <Modal isOpen={isHolidayModalOpen} onClose={() => setIsHolidayModalOpen(false)} title="הוספת יום שבתון / חג">
        <form onSubmit={handleAddHoliday} className="space-y-3 text-right">
          <Input
            label="תאריך החופשה *"
            type="date"
            value={holidayDate}
            onChange={(e) => setHolidayDate(e.target.value)}
            required
          />

          <Input
            label="סיבת החסימה / שם החג *"
            placeholder="ערב פסח / חופשה שנתית"
            value={holidayReason}
            onChange={(e) => setHolidayReason(e.target.value)}
            required
          />

          <div className="flex gap-2 pt-2">
            <Button type="button" variant="outline" className="flex-1" onClick={() => setIsHolidayModalOpen(false)}>
              ביטול
            </Button>
            <Button type="submit" className="flex-1">
              חסום תאריך
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
};
