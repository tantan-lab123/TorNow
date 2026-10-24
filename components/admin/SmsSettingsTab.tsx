"use client";

import React, { useEffect, useMemo, useState } from "react";
import { Check } from "lucide-react";
import type { Business, BusinessSettings } from "@/lib/types";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { SmsTemplateEditor } from "@/components/admin/SmsTemplateEditor";
import { alertDialog } from "@/lib/dialogs";
import { triggerHaptic } from "@/lib/utils";
import {
  DEFAULT_BOOKED_TEMPLATE,
  DEFAULT_REMINDER_TEMPLATE,
  SMS_REMINDER_OPTIONS,
  analyzeTemplate,
  normalizeReminderMinutes,
} from "@/lib/sms/message";

interface SmsSettingsTabProps {
  business: Business;
  onUpdateSettings: (updates: Partial<Business>) => Promise<void>;
}

type Usage =
  | { sent: number; segments: number; byKind?: { booked: number; reminder: number } }
  | "unavailable"
  | null;

/** The saved wording, or the default wording while there is none (the editor always shows real text). */
const shown = (saved: string | undefined, fallback: string) => saved?.trim() || fallback;

/** What is saved for a wording: nothing (null = default) when it is the default text. */
const toSave = (a: ReturnType<typeof analyzeTemplate>, text: string) => (a.isDefault ? null : a.check.ok ? a.check.template : text);

/** The "Messages" tab (owner and managers): the confirmation SMS and the reminder SMS. */
export function SmsSettingsTab({ business, onUpdateSettings }: SmsSettingsTabProps) {
  const settings = business.settings;
  const [enabled, setEnabled] = useState(settings?.sms_confirmation_enabled !== false);
  const [text, setText] = useState(shown(settings?.sms_confirmation_template, DEFAULT_BOOKED_TEMPLATE));
  const [reminderMinutes, setReminderMinutes] = useState(normalizeReminderMinutes(settings?.sms_reminder_minutes));
  const [reminderText, setReminderText] = useState(shown(settings?.sms_reminder_template, DEFAULT_REMINDER_TEMPLATE));
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [usage, setUsage] = useState<Usage>(null);

  useEffect(() => {
    let alive = true;
    fetch("/api/sms/usage", { cache: "no-store" })
      .then(async (res) => (res.ok ? ((await res.json()) as Exclude<Usage, "unavailable" | null>) : "unavailable"))
      .then((u) => alive && setUsage(u))
      .catch(() => alive && setUsage("unavailable"));
    return () => {
      alive = false;
    };
  }, []);

  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL;
  const confirmation = useMemo(
    () => analyzeTemplate("booked", text, { businessName: business.name, siteUrl }),
    [text, business.name, siteUrl]
  );
  const reminder = useMemo(
    () => analyzeTemplate("reminder", reminderText, { businessName: business.name, siteUrl }),
    [reminderText, business.name, siteUrl]
  );
  // A wording that is not in use (reminders off) does not stop the save
  const error = confirmation.error ?? (reminderMinutes > 0 ? reminder.error : null);

  const storedConfirmation = settings?.sms_confirmation_template?.trim() ?? "";
  const storedReminder = settings?.sms_reminder_template?.trim() ?? "";
  const dirty =
    enabled !== (settings?.sms_confirmation_enabled !== false) ||
    (toSave(confirmation, text) ?? "") !== storedConfirmation ||
    reminderMinutes !== normalizeReminderMinutes(settings?.sms_reminder_minutes) ||
    (toSave(reminder, reminderText) ?? "") !== storedReminder;

  const save = async () => {
    if (error) return;
    setSaving(true);
    triggerHaptic(20);
    try {
      // Settings are saved as a whole: send the stored ones along, only the SMS ones change.
      // Null = back to the default wording.
      const next = {
        ...(settings ?? {}),
        sms_confirmation_enabled: enabled,
        sms_confirmation_template: toSave(confirmation, text),
        sms_reminder_minutes: reminderMinutes,
        sms_reminder_template: toSave(reminder, reminderText),
      } as unknown as BusinessSettings;
      await onUpdateSettings({ settings: next });
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch (err) {
      await alertDialog(err instanceof Error && err.message ? err.message : "לא הצלחנו לשמור את ההגדרות. נסו שוב.");
    } finally {
      setSaving(false);
    }
  };

  const usageLine = (() => {
    if (usage === null) return "…";
    if (usage === "unavailable") return "—";
    const parts = [`${usage.sent}`];
    if (usage.byKind && usage.byKind.reminder > 0) {
      parts.push(`(${usage.byKind.booked} אישורים · ${usage.byKind.reminder} תזכורות)`);
    } else if (usage.segments > 0) {
      parts.push(`(${usage.segments} מקטעים)`);
    }
    return parts.join(" ");
  })();

  return (
    <Card className="p-5 bg-white border border-slate-200 shadow-xs text-right space-y-5">
      <div className="border-b border-slate-100 pb-3 flex items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-extrabold text-slate-900">הודעות ללקוחות</h3>
          <p className="text-xs text-ink-500 mt-0.5">SMS אישור וקישור לניהול התור, ותזכורת לפני התור</p>
        </div>
        <Button
          type="button"
          size="sm"
          onClick={save}
          isLoading={saving}
          disabled={!!error || (!dirty && !saved)}
          className="shadow-xs"
        >
          {saved ? <Check className="w-4 h-4" /> : null}
          <span>{saved ? "נשמר" : "שמור"}</span>
        </Button>
      </div>

      {/* Confirmation: on / off */}
      <div className="flex items-start gap-3">
        <button
          type="button"
          role="switch"
          aria-checked={enabled}
          aria-label="שלח ללקוח SMS אישור כשהוא קובע תור"
          onClick={() => {
            setEnabled((v) => !v);
            setSaved(false);
          }}
          className={`relative mt-0.5 h-7 w-12 shrink-0 rounded-full transition-colors ${enabled ? "bg-brand-600" : "bg-slate-300"}`}
        >
          <span
            className={`absolute top-0.5 h-6 w-6 rounded-full bg-white shadow transition-all ${enabled ? "right-0.5" : "right-[1.375rem]"}`}
          />
        </button>
        <div>
          <div className="text-sm font-bold text-slate-900">שלח ללקוח SMS אישור כשהוא קובע תור</div>
          <p className="text-xs text-ink-600 mt-0.5 leading-relaxed">
            ההודעה נשלחת רק בהזמנות של לקוחות דרך האתר, ולא בתורים שאתם מוסיפים ידנית.
          </p>
        </div>
      </div>

      <SmsTemplateEditor
        id="sms-template"
        kind="booked"
        label="נוסח הודעת האישור"
        value={text}
        onChange={(t) => {
          setText(t);
          setSaved(false);
        }}
        analysis={confirmation}
        disabled={!enabled}
      />

      <p className="rounded-lg bg-slate-50 p-3 text-xs leading-relaxed text-ink-600">
        ההודעות חייבות להיות שירותיות: ללא פרסום או הנחות, וללא קישורים חוץ מהקישור לניהול התור.
      </p>

      {/* Reminder */}
      <div className="space-y-4 border-t border-slate-100 pt-5">
        <div>
          <label htmlFor="sms-reminder-minutes" className="block text-sm font-bold text-slate-900">
            תזכורת לפני התור
          </label>
          <p className="text-xs text-ink-600 mt-0.5 leading-relaxed">
            תזכורת נשלחת לכל התורים המאושרים, גם לתורים שהוספתם ידנית (כשיש מספר טלפון תקין). לא נשלחת תזכורת אם התור נקבע
            אחרי מועד התזכורת: האישור כבר מכסה אותו.
          </p>
          <select
            id="sms-reminder-minutes"
            value={reminderMinutes}
            onChange={(e) => {
              setReminderMinutes(normalizeReminderMinutes(Number(e.target.value)));
              setSaved(false);
            }}
            className="mt-2 h-12 w-full rounded-lg border border-ink-200 bg-white px-3 text-base text-ink-900 focus:border-brand-600 focus:outline-none focus:ring-2 focus:ring-brand-600/20"
          >
            {SMS_REMINDER_OPTIONS.map((o) => (
              <option key={o.minutes} value={o.minutes}>
                {o.label}
              </option>
            ))}
          </select>
          {reminderMinutes === 1440 && (
            <p className="mt-1.5 text-xs text-ink-600">התזכורת ליום שלפני נשלחת בין 08:00 ל-21:00, כדי לא להפריע בלילה.</p>
          )}
        </div>

        {reminderMinutes > 0 && (
          <SmsTemplateEditor
            id="sms-reminder-template"
            kind="reminder"
            label="נוסח התזכורת"
            value={reminderText}
            onChange={(t) => {
              setReminderText(t);
              setSaved(false);
            }}
            analysis={reminder}
          />
        )}
      </div>

      <div className="border-t border-slate-100 pt-3 text-xs text-ink-600">
        נשלחו החודש: <strong className="text-ink-900">{usageLine}</strong>
      </div>
    </Card>
  );
}
