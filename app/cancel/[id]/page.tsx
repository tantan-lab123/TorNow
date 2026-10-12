"use client";

import React, { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  AlertTriangle,
  CheckCircle2,
  Calendar,
  Clock,
  User,
} from "lucide-react";
import { Appointment } from "@/lib/types";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { formatHebrewDate, formatTime, toInternationalPhone, triggerHaptic } from "@/lib/utils";
import { format, startOfToday } from "date-fns";
import { alertDialog } from "@/lib/dialogs";
import { israelDateString } from "@/lib/booking/slotGenerator";

interface Slot {
  startTime: string;
  formattedTime: string;
}
type Details = Appointment & {
  can_modify?: boolean;
  modify_blocked_reason?: string;
  service_id?: string;
  business_id?: string;
};

export default function CancelAppointmentPage() {
  const params = useParams();
  const router = useRouter();
  const appointmentId = params.id as string;

  const [appointment, setAppointment] = useState<Appointment | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isCancelling, setIsCancelling] = useState(false);
  const [isCancelledSuccess, setIsCancelledSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [blockedReason, setBlockedReason] = useState<string | null>(null);

  // Rescheduling
  const [moveOpen, setMoveOpen] = useState(false);
  const [moveDate, setMoveDate] = useState(format(startOfToday(), "yyyy-MM-dd"));
  const [moveSlots, setMoveSlots] = useState<Slot[]>([]);
  const [moveLoading, setMoveLoading] = useState(false);
  const [moveMsg, setMoveMsg] = useState<{ ok: boolean; text: string } | null>(null);
  // Both actions take two taps: a mis-tap on a phone must not cancel or move a booking
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [pendingSlot, setPendingSlot] = useState<Slot | null>(null);

  useEffect(() => {
    const loadAppointment = async () => {
      try {
        setIsLoading(true);
        const res = await fetch(`/api/appointments/${appointmentId}`);
        if (!res.ok) {
          setError("התור המבוקש לא נמצא במערכת.");
          return;
        }
        const data = await res.json();
        setAppointment(data);
        if (data.status === "cancelled") {
          setIsCancelledSuccess(true);
        }
      } catch (err) {
        console.error("Error loading appointment:", err);
        setError("שגיאת תקשורת בטעינת פרטי התור.");
      } finally {
        setIsLoading(false);
      }
    };
    loadAppointment();
  }, [appointmentId]);

  const handleCancel = async () => {
    if (!appointment) return;
    setIsCancelling(true);
    triggerHaptic(30);

    try {
      const res = await fetch(`/api/appointments/${appointmentId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "cancelled" }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        if (data.blocked) {
          setBlockedReason(data.error);
        } else {
          await alertDialog(data.error || "שגיאה בביטול התור");
        }
        setIsCancelling(false);
        return;
      }

      setIsCancelledSuccess(true);
      setAppointment((prev) => (prev ? { ...prev, status: "cancelled" } : null));
    } catch (err) {
      console.error("Cancel error:", err);
      await alertDialog("שגיאה בביטול התור");
    } finally {
      setIsCancelling(false);
    }
  };

  const details = appointment as Details | null;

  const loadMoveSlots = async (dateStr: string) => {
    if (!details?.business_id || !details.service_id) return;
    setMoveDate(dateStr);
    setPendingSlot(null);
    setMoveLoading(true);
    setMoveMsg(null);
    try {
      const res = await fetch(
        `/api/slots?business_id=${details.business_id}&service_id=${details.service_id}&date=${dateStr}`
      );
      const data = res.ok ? await res.json() : { slots: [] };
      setMoveSlots(data.slots || []);
      if (!(data.slots || []).length) {
        setMoveMsg({ ok: false, text: data.message || "אין שעות פנויות ביום הזה" });
      }
    } finally {
      setMoveLoading(false);
    }
  };

  const doMove = async (slot: Slot) => {
    triggerHaptic(25);
    setMoveLoading(true);
    setMoveMsg(null);
    try {
      const res = await fetch(`/api/appointments/${appointmentId}/reschedule`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ start_time: slot.startTime }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (data.blocked) setBlockedReason(data.error);
        setPendingSlot(null);
        setMoveMsg({ ok: false, text: data.error || "לא הצלחנו לשנות את התור" });
        return;
      }
      setAppointment((prev) =>
        prev
          ? { ...prev, start_time: data.appointment.start_time, end_time: data.appointment.end_time }
          : prev
      );
      setMoveMsg({
        ok: true,
        text: `התור הועבר ל${formatHebrewDate(data.appointment.start_time)} בשעה ${formatTime(data.appointment.start_time)}`,
      });
      setMoveOpen(false);
      setMoveSlots([]);
      setPendingSlot(null);
    } finally {
      setMoveLoading(false);
    }
  };

  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen p-6 text-center">
        <div className="w-10 h-10 border-3 border-indigo-600 border-t-transparent rounded-full animate-spin mb-4" />
        <p className="text-sm text-slate-500">טוען פרטי תור לביטול...</p>
      </div>
    );
  }

  if (error || !appointment) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
        <Card className="max-w-md w-full p-6 text-center space-y-4">
          <div className="w-14 h-14 bg-red-100 text-red-600 rounded-full flex items-center justify-center mx-auto">
            <AlertTriangle className="w-7 h-7" />
          </div>
          <h2 className="text-xl font-bold text-slate-900">התור לא נמצא</h2>
          <p className="text-sm text-slate-500">{error || "הקישור אינו תקין או פג תוקף"}</p>
          <Button onClick={() => router.push("/")} variant="outline" className="w-full">
            חזרה לדף הראשי
          </Button>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 p-4 flex flex-col items-center justify-center">
      <div className="max-w-md w-full space-y-5">
        {/* Business Branding */}
        <div className="text-center">
          <div
            aria-hidden="true"
            className="w-12 h-12 rounded-lg bg-brand-600 text-lime text-xl font-extrabold flex items-center justify-center mx-auto mb-2"
          >
            {(appointment.business?.name || "מערכת תורים" || "").trim().charAt(0)}
          </div>
          <h1 className="text-lg font-bold text-slate-900">
            {appointment.business?.name || "מערכת תורים"}
          </h1>
          <p className="text-xs text-slate-500">ניהול וביטול תור</p>
        </div>

        {/* Status Card */}
        {isCancelledSuccess ? (
          <Card className="p-6 text-center space-y-4 border-2 border-emerald-100 bg-white">
            <div className="w-16 h-16 bg-emerald-50 text-emerald-600 rounded-full flex items-center justify-center mx-auto">
              <CheckCircle2 className="w-8 h-8" />
            </div>
            <div>
              <h2 className="text-xl font-bold text-slate-900">התור בוטל בהצלחה</h2>
              <p className="text-xs text-slate-500 mt-1">
                המועד שוחרר וכעת זמין ללקוחות אחרים.
              </p>
            </div>

            <div className="bg-slate-50 rounded-2xl p-4 text-right text-xs space-y-2 text-slate-600">
              <div className="flex justify-between">
                <span>שירות:</span>
                <span className="font-semibold text-slate-900">
                  {appointment.service?.name}
                </span>
              </div>
              <div className="flex justify-between">
                <span>מועד שבוטל:</span>
                <span className="font-semibold text-slate-900">
                  {formatHebrewDate(appointment.start_time)} בשעה {formatTime(appointment.start_time)}
                </span>
              </div>
            </div>

            {appointment.business?.slug && (
              <Button
                onClick={() => router.push(`/${appointment.business?.slug}`)}
                className="w-full"
              >
                <span>לקביעת תור חדש</span>
              </Button>
            )}
          </Card>
        ) : (
          <Card className="p-6 text-right space-y-5">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div>
                <span className="text-xs text-ink-500 block">סטטוס:</span>
                <Badge variant="success">מאושר</Badge>
              </div>
              <div className="text-right">
                <h3 className="font-bold text-base text-slate-900">
                  {appointment.service?.name}
                </h3>
                <span className="text-xs text-slate-500">
                  ₪{appointment.service?.price}
                </span>
              </div>
            </div>

            {/* Details */}
            <div className="space-y-3 text-sm">
              <div className="flex items-center gap-2.5 text-slate-700">
                <Calendar className="w-4 h-4 text-indigo-600" />
                <span>{formatHebrewDate(appointment.start_time)}</span>
              </div>
              <div className="flex items-center gap-2.5 text-slate-700">
                <Clock className="w-4 h-4 text-indigo-600" />
                <span>
                  בשעה {formatTime(appointment.start_time)} עד{" "}
                  {formatTime(appointment.end_time)}
                </span>
              </div>
              <div className="flex items-center gap-2.5 text-slate-700">
                <User className="w-4 h-4 text-indigo-600" />
                <span>
                  עבור: {appointment.client?.first_name} {appointment.client?.last_name}
                </span>
              </div>
            </div>

            {/* Policy: too close to the appointment -> contact the business */}
            {(blockedReason || (details && details.can_modify === false && details.modify_blocked_reason)) ? (
              <div className="space-y-3 pt-2">
                <div className="rounded-2xl border border-amber-200 bg-amber-50 p-3.5 text-xs text-amber-900">
                  {blockedReason || details?.modify_blocked_reason}
                </div>
                {appointment.business?.owner_phone && (
                  <div className="flex gap-2">
                    <a
                      href={`tel:${appointment.business.owner_phone}`}
                      className="flex-1 h-11 rounded-2xl bg-slate-100 text-slate-800 font-bold text-sm flex items-center justify-center hover:bg-slate-200"
                    >
                      חייג לעסק
                    </a>
                    <a
                      href={`https://wa.me/${toInternationalPhone(appointment.business.owner_phone)}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex-1 h-11 rounded-2xl bg-emerald-50 text-emerald-700 border border-emerald-200 font-bold text-sm flex items-center justify-center hover:bg-emerald-100"
                    >
                      וואטסאפ
                    </a>
                  </div>
                )}
              </div>
            ) : (
              <>
                {moveMsg?.ok && (
                  <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-3 text-sm font-bold text-emerald-800 text-center">
                    {moveMsg.text}
                  </div>
                )}

                {/* Reschedule */}
                <div className="space-y-2 pt-2">
                  {!moveOpen ? (
                    <Button
                      variant="outline"
                      size="lg"
                      className="w-full"
                      onClick={() => {
                        setConfirmCancel(false);
                        setMoveOpen(true);
                        // start from the day of the current booking (never a day in the past)
                        const today = format(startOfToday(), "yyyy-MM-dd");
                        const current = details?.start_time ? israelDateString(details.start_time) : today;
                        loadMoveSlots(current < today ? today : current);
                      }}
                    >
                      <span>שנה מועד</span>
                    </Button>
                  ) : (
                    <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3 space-y-3 text-right">
                      <label className="block text-xs font-bold text-slate-700">בחר תאריך חדש</label>
                      <input
                        type="date"
                        min={format(startOfToday(), "yyyy-MM-dd")}
                        value={moveDate}
                        onChange={(e) => e.target.value && loadMoveSlots(e.target.value)}
                        className="w-full h-11 rounded-2xl border border-slate-200 px-3 text-sm bg-white"
                      />
                      {moveLoading && <p className="text-xs text-slate-500">בודק זמינות...</p>}
                      {!moveLoading && moveSlots.length > 0 && (
                        <div className="grid grid-cols-4 gap-2">
                          {moveSlots.map((sl) => {
                            const picked = pendingSlot?.startTime === sl.startTime;
                            return (
                              <button
                                key={sl.startTime}
                                type="button"
                                aria-pressed={picked}
                                onClick={() => {
                                  triggerHaptic(10);
                                  setPendingSlot(sl);
                                }}
                                className={`h-11 rounded-xl border text-sm font-bold ${
                                  picked
                                    ? "border-indigo-600 bg-indigo-600 text-white"
                                    : "border-slate-200 bg-white text-slate-800 hover:border-indigo-500 hover:text-indigo-700"
                                }`}
                              >
                                {sl.formattedTime}
                              </button>
                            );
                          })}
                        </div>
                      )}
                      {pendingSlot && (
                        <div className="rounded-2xl border border-slate-200 bg-white p-3 space-y-2">
                          <p className="text-sm font-bold text-slate-900">
                            להעביר את התור ל{formatHebrewDate(pendingSlot.startTime)} בשעה {pendingSlot.formattedTime}?
                          </p>
                          <Button
                            size="lg"
                            className="w-full"
                            isLoading={moveLoading}
                            onClick={() => doMove(pendingSlot)}
                          >
                            <span>אישור המעבר</span>
                          </Button>
                        </div>
                      )}
                      {moveMsg && !moveMsg.ok && <p className="text-xs font-bold text-rose-600">{moveMsg.text}</p>}
                      <Button
                        variant="ghost"
                        className="w-full text-xs"
                        onClick={() => {
                          setMoveOpen(false);
                          setPendingSlot(null);
                        }}
                      >
                        השארת המועד הנוכחי
                      </Button>
                    </div>
                  )}
                </div>

                {/* Cancel Action */}
                {!confirmCancel ? (
                  <Button
                    variant="destructive"
                    size="lg"
                    onClick={() => {
                      triggerHaptic(10);
                      setMoveOpen(false);
                      setPendingSlot(null);
                      setConfirmCancel(true);
                    }}
                    className="w-full"
                  >
                    <span>ביטול התור</span>
                  </Button>
                ) : (
                  <div role="alertdialog" aria-labelledby="cancel-q" className="rounded-2xl border border-rose-200 bg-rose-50 p-3.5 space-y-2.5">
                    <p id="cancel-q" className="text-sm font-bold text-rose-900">
                      לבטל את התור ב{formatHebrewDate(appointment.start_time)} בשעה {formatTime(appointment.start_time)}?
                    </p>
                    <p className="text-xs text-rose-800">המועד ישתחרר מיד לאחרים, ואי אפשר לבטל את הביטול.</p>
                    <div className="flex gap-2">
                      <Button
                        variant="destructive"
                        size="lg"
                        onClick={handleCancel}
                        isLoading={isCancelling}
                        className="flex-1"
                      >
                        <span>כן, לבטל</span>
                      </Button>
                      <Button
                        variant="outline"
                        size="lg"
                        onClick={() => setConfirmCancel(false)}
                        disabled={isCancelling}
                        className="flex-1"
                      >
                        <span>לא, להשאיר</span>
                      </Button>
                    </div>
                  </div>
                )}
              </>
            )}

            {appointment.business?.slug && (
              <Button
                variant="ghost"
                onClick={() => router.push(`/${appointment.business?.slug}`)}
                className="w-full text-xs text-slate-500"
              >
                חזרה לעמוד העסק
              </Button>
            )}
          </Card>
        )}
      </div>
    </div>
  );
}
