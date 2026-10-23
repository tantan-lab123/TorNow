"use client";

import React, { useEffect, useState } from "react";
import {
  CalendarDays,
  BarChart3,
  Users,
  Scissors,
  Clock,
  UserCheck,
  Package,
  MessageSquare,
  CreditCard,
  Settings,
  ExternalLink,
  LogOut,
  LayoutGrid,
  ChevronLeft,
  X,
} from "lucide-react";
import { Business } from "@/lib/types";
import { cn, triggerHaptic } from "@/lib/utils";
import { LogoMark } from "@/components/brand/Logo";
import { ADMIN_TABS, visibleNavItems, type AdminTab } from "@/lib/admin-nav";

export type { AdminTab };

interface AdminTopBarProps {
  business: Business;
  activeTab: AdminTab;
  onTabChange: (tab: AdminTab) => void;
  onLogout: () => void;
  role?: "owner" | "manager" | "staff";
  staffName?: string;
}

const TAB_ICONS: Record<AdminTab, React.ElementType> = {
  calendar: CalendarDays,
  stats: BarChart3,
  customers: Users,
  messages: MessageSquare,
  services: Scissors,
  workschedule: Clock,
  employees: UserCheck,
  products: Package,
  cashregister: CreditCard,
  settings: Settings,
};

export const ADMIN_NAV_ITEMS: {
  id: AdminTab;
  label: string;
  icon: React.ElementType;
  badge?: string;
}[] = ADMIN_TABS.map((t) => ({ ...t, icon: TAB_ICONS[t.id] }));

// Phone tab bar: two tabs on each side of the center "new appointment" button (AdminFAB).
const BAR_START: AdminTab[] = ["calendar", "customers"];
const BAR_END: AdminTab[] = ["stats"];

export const AdminTopBar: React.FC<AdminTopBarProps> = ({
  business,
  activeTab,
  onTabChange,
  onLogout,
  role = "owner",
  staffName,
}) => {
  const [moreOpen, setMoreOpen] = useState(false);

  // The server enforces permissions; this just hides what the person cannot use.
  const visible = visibleNavItems(role).map((t) => t.id);
  const items = ADMIN_NAV_ITEMS.filter((i) => visible.includes(i.id));
  const has = (id: AdminTab) => items.some((i) => i.id === id);
  const barEnd = BAR_END.filter(has);
  const moreItems = items.filter((i) => !BAR_START.includes(i.id) && !barEnd.includes(i.id));
  const moreActive = moreItems.some((i) => i.id === activeTab);

  useEffect(() => {
    if (!moreOpen) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setMoreOpen(false);
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [moreOpen]);

  const go = (id: AdminTab) => {
    triggerHaptic(10);
    setMoreOpen(false);
    onTabChange(id);
  };

  const tab = (id: AdminTab) => {
    const item = ADMIN_NAV_ITEMS.find((i) => i.id === id)!;
    const Icon = item.icon;
    const on = activeTab === id;
    return (
      <button
        key={id}
        type="button"
        onClick={() => go(id)}
        aria-current={on ? "page" : undefined}
        className={cn(
          "m-tab m-press flex-1 min-w-0 h-14 flex flex-col items-center justify-center gap-0.5 text-[11px] font-semibold",
          on ? "text-brand-600" : "text-ink-500"
        )}
      >
        <Icon className="w-[22px] h-[22px]" strokeWidth={on ? 2.2 : 1.8} />
        <span className="truncate">{item.label}</span>
      </button>
    );
  };

  return (
    <>
      <header className="sticky top-0 z-40 bg-white/95 backdrop-blur-md border-b border-ink-200">
        {/* Top row: business identity and actions */}
        <div className="max-w-7xl mx-auto px-4 h-14 md:h-16 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5 min-w-0">
            <LogoMark size={32} />
            <div className="text-right min-w-0">
              <div className="text-[15px] sm:text-base font-extrabold text-ink-900 leading-tight flex items-center gap-2 min-w-0">
                <span className="truncate">{business.name}</span>
                {role !== "owner" && (
                  <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-brand-50 text-brand-700 border border-brand-200 flex-none">
                    {staffName ? `${staffName} · ` : ""}{role === "manager" ? "מנהל" : "עובד"}
                  </span>
                )}
              </div>
              <div className="hidden sm:flex items-center gap-2 text-[11px] text-ink-500 font-medium">
                <span dir="ltr" className="font-mono">/{business.slug}</span>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2 flex-none">
            <a
              href={`/${business.slug}`}
              target="_blank"
              rel="noopener noreferrer"
              className="m-key2 inline-flex items-center gap-1.5 h-10 px-3 rounded-lg border border-ink-200 bg-white text-xs font-bold text-ink-800"
              title="פתיחת עמוד ההזמנה של העסק בלשונית חדשה"
            >
              <ExternalLink className="w-3.5 h-3.5" />
              <span>עמוד העסק</span>
            </a>

            <button
              onClick={onLogout}
              className="m-press hidden md:inline-flex items-center gap-1.5 h-10 px-3 rounded-lg text-xs font-bold text-danger-600 hover:bg-danger-50"
              title="התנתקות מהמערכת"
            >
              <LogOut className="w-3.5 h-3.5" />
              <span>התנתקות</span>
            </button>
          </div>
        </div>

        {/* Desktop: all sections in one row */}
        <div className="hidden md:block border-t border-ink-200 bg-paper/70">
          <div className="max-w-7xl mx-auto px-4">
            <nav aria-label="ניווט ראשי" className="flex items-center gap-1 overflow-x-auto no-scrollbar py-1.5 text-[13px]">
              {items.map((item) => {
                const Icon = item.icon;
                const isActive = activeTab === item.id;
                return (
                  <button
                    key={item.id}
                    onClick={() => go(item.id)}
                    aria-current={isActive ? "page" : undefined}
                    className={cn(
                      "m-press flex items-center gap-1.5 h-9 px-3 rounded-md font-semibold whitespace-nowrap flex-shrink-0",
                      isActive ? "bg-brand-600 text-white" : "text-ink-700 hover:bg-ink-100"
                    )}
                  >
                    <Icon className="w-4 h-4" />
                    <span>{item.label}</span>
                    {item.badge && (
                      <span
                        className={cn(
                          "text-[10px] px-1.5 rounded font-bold leading-4",
                          isActive ? "bg-white/20 text-white" : "bg-pending-100 text-pending-700"
                        )}
                      >
                        {item.badge}
                      </span>
                    )}
                  </button>
                );
              })}
            </nav>
          </div>
        </div>
      </header>

      {/* Phone: bottom tab bar. The center gap is where AdminFAB sits. */}
      <nav
        aria-label="ניווט ראשי"
        className="md:hidden fixed inset-x-0 bottom-0 z-40 bg-white/95 backdrop-blur-md border-t border-ink-200"
        style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
      >
        <div className="flex items-stretch px-2">
          {BAR_START.filter(has).map(tab)}
          <div className="w-[76px] flex-none" aria-hidden="true" />
          {barEnd.map(tab)}
          <button
            type="button"
            onClick={() => {
              triggerHaptic(10);
              setMoreOpen(true);
            }}
            aria-current={moreActive ? "page" : undefined}
            aria-haspopup="dialog"
            className={cn(
              "m-tab m-press flex-1 min-w-0 h-14 flex flex-col items-center justify-center gap-0.5 text-[11px] font-semibold",
              moreActive ? "text-brand-600" : "text-ink-500"
            )}
          >
            <LayoutGrid className="w-[22px] h-[22px]" strokeWidth={moreActive ? 2.2 : 1.8} />
            <span>עוד</span>
          </button>
        </div>
      </nav>

      {/* "More" sheet */}
      {moreOpen && (
        <div className="md:hidden fixed inset-0 z-[60] flex items-end">
          <div className="absolute inset-0 bg-ink-950/45 animate-in fade-in" onClick={() => setMoreOpen(false)} />
          <div
            role="dialog"
            aria-modal="true"
            aria-label="עוד"
            className="relative w-full bg-paper rounded-t-2xl border-t border-ink-200 animate-in slide-in-from-bottom max-h-[85vh] overflow-y-auto"
            style={{ paddingBottom: "calc(env(safe-area-inset-bottom) + 12px)" }}
          >
            <div className="mx-auto mt-2.5 h-1 w-10 rounded-full bg-ink-300" />
            <div className="flex items-center justify-between px-4 pt-2 pb-1">
              <h2 className="text-lg font-extrabold text-ink-900">עוד</h2>
              <button
                type="button"
                onClick={() => setMoreOpen(false)}
                aria-label="סגירה"
                className="m-press -ml-2 w-11 h-11 rounded-lg flex items-center justify-center text-ink-500"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="mx-4 rounded-xl border border-ink-200 bg-white overflow-hidden">
              {moreItems.map((item) => {
                const Icon = item.icon;
                const on = activeTab === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => go(item.id)}
                    aria-current={on ? "page" : undefined}
                    className={cn(
                      "w-full min-h-[52px] px-4 flex items-center gap-3 text-right border-b border-ink-100 last:border-b-0 active:bg-ink-50",
                      on && "bg-brand-50"
                    )}
                  >
                    <Icon className={cn("w-5 h-5", on ? "text-brand-600" : "text-ink-600")} />
                    <span className="flex-1 font-semibold text-ink-900">{item.label}</span>
                    {item.badge && (
                      <span className="text-[10px] px-1.5 rounded font-bold leading-4 bg-pending-100 text-pending-700">{item.badge}</span>
                    )}
                    <ChevronLeft className="w-4 h-4 text-ink-500" />
                  </button>
                );
              })}
            </div>
            <div className="mx-4 mt-3 rounded-xl border border-ink-200 bg-white overflow-hidden">
              <button
                type="button"
                onClick={() => {
                  setMoreOpen(false);
                  onLogout();
                }}
                className="w-full min-h-[52px] px-4 flex items-center gap-3 text-right font-semibold text-danger-600 active:bg-danger-50"
              >
                <LogOut className="w-5 h-5" />
                <span>התנתקות</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};
