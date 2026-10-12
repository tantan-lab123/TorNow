"use client";

import React, { useState, useMemo } from "react";
import {
  BarChart3,
  TrendingUp,
  DollarSign,
  CalendarCheck,
  Users,
  Scissors,
  Clock,
  CalendarDays,
  Sparkles,
} from "lucide-react";
import { Appointment, Service, Client } from "@/lib/types";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { isBlockedTime, triggerHaptic } from "@/lib/utils";
import { isSameDay, isSameMonth, subDays, isAfter, format } from "date-fns";

interface StatsSectionProps {
  appointments: Appointment[];
  services: Service[];
  clients: Client[];
}

export const StatsSection: React.FC<StatsSectionProps> = ({
  appointments,
  services,
  clients,
}) => {
  const [timeframe, setTimeframe] = useState<"today" | "week" | "month">("today");

  const today = useMemo(() => new Date(), []);

  // Filtered appointments based on timeframe (time the business blocked for itself is not a booking)
  const filteredAppointments = useMemo(() => {
    const bookings = appointments.filter((a) => !isBlockedTime(a));
    if (timeframe === "today") {
      return bookings.filter((a) => {
        try {
          return isSameDay(new Date(a.start_time), today);
        } catch {
          return false;
        }
      });
    }

    if (timeframe === "week") {
      // the last 7 days up to now, not every future booking
      const weekAgo = subDays(today, 7);
      return bookings.filter((a) => {
        const start = new Date(a.start_time);
        return isAfter(start, weekAgo) && !isAfter(start, today);
      });
    }

    // This calendar month (the admin may hold older and later appointments too)
    return bookings.filter((a) => isSameMonth(new Date(a.start_time), today));
  }, [appointments, timeframe, today]);

  // Compute metrics
  const stats = useMemo(() => {
    const confirmed = filteredAppointments.filter((a) => a.status === "confirmed");
    const cancelled = filteredAppointments.filter((a) => a.status === "cancelled");

    let totalRevenue = 0;
    const serviceCounts: Record<string, { count: number; revenue: number; name: string }> = {};

    confirmed.forEach((app) => {
      const s = services.find((srv) => srv.id === app.service_id) || app.service;
      const price = s?.price || 0;
      const name = s?.name || "טיפול כללי";
      totalRevenue += price;

      if (!serviceCounts[app.service_id]) {
        serviceCounts[app.service_id] = { count: 0, revenue: 0, name };
      }
      serviceCounts[app.service_id].count += 1;
      serviceCounts[app.service_id].revenue += price;
    });

    const topServices = Object.values(serviceCounts).sort((a, b) => b.count - a.count);

    // Weekday distribution
    const weekdayCounts = [0, 0, 0, 0, 0, 0, 0]; // Sun to Sat
    const dayNames = ["ראשון", "שני", "שלישי", "רביעי", "חמישי", "שישי", "שבת"];
    confirmed.forEach((app) => {
      try {
        const day = new Date(app.start_time).getDay();
        weekdayCounts[day] += 1;
      } catch {
        // ignore
      }
    });

    const confirmationRate = filteredAppointments.length
      ? Math.round((confirmed.length / filteredAppointments.length) * 100)
      : null; // nothing booked yet: no rate to show

    return {
      totalAppointments: filteredAppointments.length,
      confirmedCount: confirmed.length,
      cancelledCount: cancelled.length,
      totalRevenue,
      confirmationRate,
      topServices,
      weekdayCounts,
      dayNames,
      confirmedAppointmentsList: confirmed.sort(
        (a, b) => new Date(a.start_time).getTime() - new Date(b.start_time).getTime()
      ),
    };
  }, [filteredAppointments, services]);

  return (
    <div className="space-y-4">
      {/* Timeframe Switcher (יומי / שבועי / חודשי) as requested */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 bg-white p-3.5 rounded-2xl border border-slate-200 shadow-xs">
        <div className="text-right">
          <h2 className="text-sm font-extrabold text-slate-900 flex items-center gap-1.5">
            <BarChart3 className="w-4 h-4 text-indigo-600" />
            <span>דשבורד סטטיסטיקה ודוחות ביצועים</span>
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">
            צפה בהכנסות, בכמות התורים ובהתפלגות העבודה לפי יום, שבוע או חודש
          </p>
        </div>

        {/* Timeframe Pills */}
        <div className="flex bg-slate-100 p-1 rounded-2xl border border-slate-200">
          <button
            type="button"
            onClick={() => {
              triggerHaptic(10);
              setTimeframe("today");
            }}
            className={`min-h-[44px] px-4 rounded-xl text-xs font-extrabold transition-all flex items-center gap-1.5 ${
              timeframe === "today"
                ? "bg-indigo-600 text-white shadow-xs"
                : "text-slate-600 hover:text-slate-900"
            }`}
          >
            <Sparkles className="w-3.5 h-3.5" />
            <span>היום (יומי)</span>
          </button>

          <button
            type="button"
            onClick={() => {
              triggerHaptic(10);
              setTimeframe("week");
            }}
            className={`min-h-[44px] px-4 rounded-xl text-xs font-extrabold transition-all flex items-center gap-1.5 ${
              timeframe === "week"
                ? "bg-indigo-600 text-white shadow-xs"
                : "text-slate-600 hover:text-slate-900"
            }`}
          >
            <Clock className="w-3.5 h-3.5" />
            <span>7 ימים אחרונים</span>
          </button>

          <button
            type="button"
            onClick={() => {
              triggerHaptic(10);
              setTimeframe("month");
            }}
            className={`min-h-[44px] px-4 rounded-xl text-xs font-extrabold transition-all flex items-center gap-1.5 ${
              timeframe === "month"
                ? "bg-indigo-600 text-white shadow-xs"
                : "text-slate-600 hover:text-slate-900"
            }`}
          >
            <CalendarDays className="w-3.5 h-3.5" />
            <span>כל החודש</span>
          </button>
        </div>
      </div>

      {/* 4 Top Metric Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Card className="p-4 bg-white border border-slate-200 shadow-xs text-right">
          <div className="flex items-center justify-between mb-2">
            <div className="w-9 h-9 rounded-xl bg-emerald-50 text-emerald-600 flex items-center justify-center font-bold">
              <DollarSign className="w-5 h-5" />
            </div>
            <span className="text-[11px] font-bold text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-full border border-emerald-100">
              {timeframe === "today" ? "היום" : timeframe === "week" ? "שבועי" : "חודשי"}
            </span>
          </div>
          <div className="text-2xl font-black text-slate-900 font-mono">
            ₪{stats.totalRevenue.toLocaleString()}
          </div>
          <div className="text-xs text-slate-500 mt-0.5 font-medium">
            {timeframe === "today" ? "סך הכנסות משוערות להיום" : "סך כל ההכנסות בתקופה"}
          </div>
        </Card>

        <Card className="p-4 bg-white border border-slate-200 shadow-xs text-right">
          <div className="flex items-center justify-between mb-2">
            <div className="w-9 h-9 rounded-xl bg-indigo-50 text-indigo-600 flex items-center justify-center font-bold">
              <CalendarCheck className="w-5 h-5" />
            </div>
            {stats.confirmationRate !== null && (
              <span className="text-[11px] font-bold text-indigo-600 bg-indigo-50 px-2 py-0.5 rounded-full border border-indigo-100">
                {stats.confirmationRate}% הצלחה
              </span>
            )}
          </div>
          <div className="text-2xl font-black text-slate-900 font-mono">{stats.confirmedCount}</div>
          <div className="text-xs text-slate-500 mt-0.5 font-medium">
            {timeframe === "today"
              ? "תורים מאושרים להיום"
              : timeframe === "week"
                ? "תורים מאושרים שהתקיימו"
                : "תורים מאושרים החודש"}
          </div>
        </Card>

        <Card className="p-4 bg-white border border-slate-200 shadow-xs text-right">
          <div className="flex items-center justify-between mb-2">
            <div className="w-9 h-9 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center font-bold">
              <Users className="w-5 h-5" />
            </div>
            <span className="text-[11px] font-bold text-slate-500 bg-slate-100 px-2 py-0.5 rounded-full">
              לקוחות
            </span>
          </div>
          <div className="text-2xl font-black text-slate-900 font-mono">
            {timeframe === "today"
              ? new Set(stats.confirmedAppointmentsList.map((a) => a.client_id)).size
              : clients.length}
          </div>
          <div className="text-xs text-slate-500 mt-0.5 font-medium">
            {timeframe === "today" ? "לקוחות ייחודיים היום" : "לקוחות רשומים במערכת"}
          </div>
        </Card>

        <Card className="p-4 bg-white border border-slate-200 shadow-xs text-right">
          <div className="flex items-center justify-between mb-2">
            <div className="w-9 h-9 rounded-xl bg-rose-50 text-rose-600 flex items-center justify-center font-bold">
              <TrendingUp className="w-5 h-5" />
            </div>
            <span className="text-[11px] font-bold text-rose-700 bg-rose-50 px-2 py-0.5 rounded-full border border-rose-100">
              ביטולים
            </span>
          </div>
          <div className="text-2xl font-black text-slate-900 font-mono">{stats.cancelledCount}</div>
          <div className="text-xs text-slate-500 mt-0.5 font-medium">
            {timeframe === "today" ? "תורים שבוטלו היום" : "תורים שבוטלו בתקופה"}
          </div>
        </Card>
      </div>

      {/* Daily Breakdown: Show today's appointments schedule when in 'today' view */}
      {timeframe === "today" && (
        <Card className="p-5 bg-white border border-slate-200 shadow-xs text-right space-y-3.5">
          <div className="flex items-center justify-between border-b border-slate-100 pb-3">
            <div className="flex items-center gap-2">
              <Clock className="w-4 h-4 text-indigo-600" />
              <h3 className="text-sm font-extrabold text-slate-900">
                לוח תורים להיום ({format(today, "dd/MM/yyyy")})
              </h3>
            </div>
            <span className="text-xs font-bold text-indigo-600 bg-indigo-50 px-2.5 py-0.5 rounded-full">
              {stats.confirmedAppointmentsList.length} תורים נקבעו להיום
            </span>
          </div>

          {stats.confirmedAppointmentsList.length === 0 ? (
            <div className="text-center py-8 text-slate-400 text-xs">
              אין תורים שנקבעו להיום. לחץ על כפתור ה-&quot;+&quot; הצף כדי להוסיף תור מהיר!
            </div>
          ) : (
            <div className="divide-y divide-slate-100">
              {stats.confirmedAppointmentsList.map((app) => {
                const s = services.find((srv) => srv.id === app.service_id) || app.service;
                return (
                  <div
                    key={app.id}
                    className="py-3 flex items-center justify-between gap-3 text-xs hover:bg-slate-50/80 px-2 rounded-xl transition-colors"
                  >
                    <div className="flex items-center gap-3">
                      <span className="font-mono font-black text-sm text-indigo-600 bg-indigo-50 px-2.5 py-1 rounded-xl border border-indigo-100">
                        {format(new Date(app.start_time), "HH:mm")}
                      </span>
                      <div className="text-right">
                        <div className="font-extrabold text-slate-900 text-sm">
                          {app.client?.first_name} {app.client?.last_name}
                        </div>
                        <div className="text-slate-400 text-[11px] font-medium">
                          {s?.name || "טיפול כללי"}
                        </div>
                      </div>
                    </div>

                    <div className="text-left flex items-center gap-3">
                      <span className="font-black text-slate-900 font-mono text-sm">
                        ₪{s?.price || 0}
                      </span>
                      <Badge variant="success" className="text-[10px]">
                        מאושר
                      </Badge>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </Card>
      )}

      {/* Two Column Layout: Top Services & Weekday Activity */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Top Services */}
        <Card className="p-5 bg-white border border-slate-200 shadow-xs text-right space-y-4">
          <div className="flex items-center justify-between border-b border-slate-100 pb-3">
            <div className="flex items-center gap-2">
              <Scissors className="w-4 h-4 text-indigo-600" />
              <h3 className="text-sm font-extrabold text-slate-900">השירותים המבוקשים ביותר</h3>
            </div>
            <span className="text-xs text-slate-400 font-medium">לפי כמות תורים</span>
          </div>

          <div className="space-y-3">
            {stats.topServices.length === 0 ? (
              <div className="text-center py-6 text-xs text-slate-400">טרם נקבעו תורים בתקופה זו</div>
            ) : (
              stats.topServices.slice(0, 5).map((srv, idx) => {
                const percent = stats.confirmedCount
                  ? Math.round((srv.count / stats.confirmedCount) * 100)
                  : 0;

                return (
                  <div key={idx} className="space-y-1.5">
                    <div className="flex items-center justify-between text-xs font-bold">
                      <span className="text-slate-800">{srv.name}</span>
                      <span className="text-indigo-600 font-mono">
                        {srv.count} תורים (₪{srv.revenue.toLocaleString()})
                      </span>
                    </div>
                    <div className="w-full h-2 bg-slate-100 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-indigo-600 rounded-full transition-all duration-500"
                        style={{ width: `${percent}%` }}
                      />
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </Card>

        {/* Days Distribution */}
        <Card className="p-5 bg-white border border-slate-200 shadow-xs text-right space-y-4">
          <div className="flex items-center justify-between border-b border-slate-100 pb-3">
            <div className="flex items-center gap-2">
              <BarChart3 className="w-4 h-4 text-emerald-600" />
              <h3 className="text-sm font-extrabold text-slate-900">התפלגות ימי עבודה עמוסים</h3>
            </div>
            <span className="text-xs text-slate-400 font-medium">תורים מאושרים</span>
          </div>

          <div className="grid grid-cols-7 gap-1.5 pt-4 text-center items-end h-44">
            {stats.weekdayCounts.map((count, dayIdx) => {
              const maxCount = Math.max(...stats.weekdayCounts, 1);
              const heightPercent = Math.max(Math.round((count / maxCount) * 100), 10);
              const isWeekend = dayIdx === 5 || dayIdx === 6;

              return (
                <div key={dayIdx} className="flex flex-col items-center gap-1.5 h-full justify-end">
                  <span className="text-[10px] font-extrabold text-slate-700 font-mono">{count}</span>
                  <div className="w-full bg-slate-100 rounded-t-lg relative flex items-end h-28 overflow-hidden">
                    <div
                      className={`w-full rounded-t-lg transition-all duration-500 ${
                        isWeekend ? "bg-amber-400" : "bg-indigo-600"
                      }`}
                      style={{ height: `${heightPercent}%` }}
                    />
                  </div>
                  <span className="text-[10px] font-bold text-slate-500">{stats.dayNames[dayIdx]}</span>
                </div>
              );
            })}
          </div>
        </Card>
      </div>
    </div>
  );
};
