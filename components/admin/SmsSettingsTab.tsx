"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { Check, MessageSquare, RotateCcw } from "lucide-react";
import type { Business, BusinessSettings } from "@/lib/types";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { alertDialog } from "@/lib/dialogs";
import { triggerHaptic } from "@/lib/utils";
import {
  DEFAULT_BOOKED_TEMPLATE,
  SMS_SEGMENTS_MAX,
  SMS_SEGMENTS_WARN,
  SMS_TEMPLATE_MAX_RAW,
  SMS_VARIABLES,
  SMS_VARIABLE_LABELS,
  cleanTemplateText,
  countSegments,
  previewVars,
  renderBookedMessageDetailed,
  validateTemplate,
  type SmsVariable,
} from "@/lib/sms/message";

interface SmsSettingsTabProps {
  business: Business;
  onUpdateSettings: (updates: Partial<Business>) => Promise<void>;
}

type Usage = { sent: number; segments: number } | "unavailable" | null;

/** Settings > "Messages" (owner and managers): the confirmation SMS switch and wording. */
export function SmsSettingsTab({ business, onUpdateSettings }: SmsSettingsTabProps) {
  const settings = business.settings;
  const [enabled, setEnabled] = useState(settings?.sms_confirmation_enabled !== false);
  const [text, setText] = useState(settings?.sms_confirmation_template?.trim() || DEFAULT_BOOKED_TEMPLATE);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [usage, setUsage] = useState<Usage>(null);
  const areaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    let alive = true;
    fetch("/api/sms/usage", { cache: "no-store" })
      .then(async (res) => (res.ok ? ((await res.json()) as { sent: number; segments: number }) : "unavailable"))
      .then((u) => alive && setUsage(u))
      .catch(() => alive && setUsage("unavailable"));
    return () => {
      alive = false;
    };
  }, []);

  const check = useMemo(() => validateTemplate(text), [text]);
  const rendered = useMemo(
    () =>
      renderBookedMessageDetailed(
        check.ok ? check.template : DEFAULT_BOOKED_TEMPLATE,
        previewVars({ businessName: business.name, siteUrl: process.env.NEXT_PUBLIC_SITE_URL })
      ),
    [check, business.name]
  );
  const info = countSegments(rendered.text);
  const tooLong = info.segments > SMS_SEGMENTS_MAX;
  const warn = info.segments > SMS_SEGMENTS_WARN && !tooLong;
  const error = !check.ok ? check.error : tooLong ? `ההודעה ארוכה מדי: ${info.segments} מקטעים (המקסימום ${SMS_SEGMENTS_MAX})` : null;

  const isDefault = check.ok && check.template === DEFAULT_BOOKED_TEMPLATE;
  const dirty =
    enabled !== (settings?.sms_confirmation_enabled !== false) ||
    (check.ok ? (isDefault ? "" : check.template) : text) !== (settings?.sms_confirmation_template?.trim() ?? "");

  const insertVariable = (v: SmsVariable) => {
    const el = areaRef.current;
    const token = `{${v}}`;
    if (!el) {
      setText((t) => `${t}${token}`);
      return;
    }
    const start = el.selectionStart ?? text.length;
    const end = el.selectionEnd ?? text.length;
    const next = `${text.slice(0, start)}${token}${text.slice(end)}`;
    setText(next);
    setSaved(false);
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(start + token.length, start + token.length);
    });
  };

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
        sms_confirmation_template: isDefault ? null : check.ok ? check.template : null,
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

  return (
    <Card className="p-5 bg-white border border-slate-200 shadow-xs text-right space-y-5">
      <div className="border-b border-slate-100 pb-3 flex items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-extrabold text-slate-900">הודעות ללקוחות</h3>
          <p className="text-xs text-ink-500 mt-0.5">SMS אישור עם קישור לניהול התור, אחרי שלקוח קובע תור</p>
        </div>
        <Button type="button" size="sm" onClick={save} isLoading={saving} disabled={!!error || (!dirty && !saved)} className="shadow-xs">
          {saved ? <Check className="w-4 h-4" /> : null}
          <span>{saved ? "נשמר" : "שמור"}</span>
        </Button>
      </div>

      {/* On / off */}
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

      {/* Wording */}
      <div className={enabled ? "space-y-3" : "space-y-3 opacity-60"}>
        <div className="flex items-center justify-between gap-2">
          <label htmlFor="sms-template" className="text-sm font-semibold text-ink-800">
            נוסח ההודעה
          </label>
          <button
            type="button"
            onClick={() => {
              setText(DEFAULT_BOOKED_TEMPLATE);
              setSaved(false);
            }}
            disabled={text === DEFAULT_BOOKED_TEMPLATE}
            className="flex items-center gap-1 text-xs font-bold text-brand-600 disabled:text-ink-400"
          >
            <RotateCcw className="w-3.5 h-3.5" aria-hidden="true" />
            <span>אפס לברירת מחדל</span>
          </button>
        </div>

        <div className="flex flex-wrap gap-1.5" aria-label="הוספת משתנה לנוסח">
          {SMS_VARIABLES.map((v) => (
            <button
              key={v}
              type="button"
              onClick={() => insertVariable(v)}
              className="min-h-[36px] rounded-full border border-ink-200 bg-ink-50 px-3 text-xs font-bold text-ink-800 hover:bg-white"
            >
              {SMS_VARIABLE_LABELS[v]}
              <span className="mr-1 text-ink-500" dir="ltr">{` {${v}}`}</span>
            </button>
          ))}
        </div>

        <textarea
          id="sms-template"
          ref={areaRef}
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            setSaved(false);
          }}
          rows={4}
          maxLength={SMS_TEMPLATE_MAX_RAW + 60}
          aria-invalid={!!error}
          aria-describedby="sms-template-help"
          className="w-full rounded-lg border border-ink-200 bg-white p-3 text-base text-ink-900 focus:border-brand-600 focus:outline-none focus:ring-2 focus:ring-brand-600/20"
        />
        <div id="sms-template-help" className="flex items-center justify-between gap-2 text-xs">
          <span className={cleanTemplateText(text).length > SMS_TEMPLATE_MAX_RAW ? "font-bold text-danger-600" : "text-ink-500"}>
            {cleanTemplateText(text).length}/{SMS_TEMPLATE_MAX_RAW} תווים בנוסח
          </span>
          <span className="text-ink-500">בלי {"{link}"} הקישור יתווסף אוטומטית בסוף</span>
        </div>
        {error && (
          <p role="alert" className="text-xs font-semibold text-danger-600">
            {error}
          </p>
        )}
        <p className="rounded-lg bg-slate-50 p-3 text-xs leading-relaxed text-ink-600">
          ההודעה חייבת להיות שירותית: ללא פרסום או הנחות, וללא קישורים חוץ מהקישור לניהול התור.
        </p>
      </div>

      {/* Live preview and length */}
      <div className="space-y-2">
        <div className="flex items-center gap-1.5 text-sm font-semibold text-ink-800">
          <MessageSquare className="w-4 h-4" aria-hidden="true" />
          <span>כך תיראה ההודעה (נתוני דוגמה)</span>
        </div>
        <div className="rounded-2xl rounded-tr-sm bg-slate-100 p-3.5 text-sm leading-relaxed text-ink-900 whitespace-pre-line break-words">
          {rendered.text}
        </div>
        <div
          aria-live="polite"
          className={`rounded-lg px-3 py-2 text-xs font-semibold ${
            tooLong ? "bg-danger-50 text-danger-700" : warn ? "bg-amber-50 text-amber-900" : "bg-slate-50 text-ink-700"
          }`}
        >
          {info.length} תווים · {info.segments} {info.segments === 1 ? "מקטע SMS" : "מקטעי SMS"}
          {info.unicode ? " (עברית: 70 תווים להודעה, 67 לכל מקטע בהודעה ארוכה)" : ""}
          {warn && ` · הודעה של יותר מ-${SMS_SEGMENTS_WARN} מקטעים עולה יותר`}
          {tooLong && ` · מעל ${SMS_SEGMENTS_MAX} מקטעים אי אפשר לשמור`}
        </div>
      </div>

      <div className="border-t border-slate-100 pt-3 text-xs text-ink-600">
        נשלחו החודש:{" "}
        <strong className="text-ink-900">
          {usage === null ? "…" : usage === "unavailable" ? "—" : `${usage.sent}`}
        </strong>
        {usage && usage !== "unavailable" && usage.segments > 0 ? ` (${usage.segments} מקטעים)` : ""}
      </div>
    </Card>
  );
}
