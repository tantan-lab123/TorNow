"use client";

import React, { useRef } from "react";
import { MessageSquare, RotateCcw } from "lucide-react";
import {
  SMS_SEGMENTS_MAX,
  SMS_TEMPLATE_MAX_RAW,
  SMS_VARIABLES,
  SMS_VARIABLE_LABELS,
  cleanTemplateText,
  defaultTemplateFor,
  type SmsTemplateKind,
  type SmsVariable,
  type TemplateAnalysis,
} from "@/lib/sms/message";

interface SmsTemplateEditorProps {
  /** Unique on the page (labels and aria ids hang on it) */
  id: string;
  kind: SmsTemplateKind;
  label: string;
  value: string;
  onChange: (text: string) => void;
  /** The analysis of the current text (the parent computes it: it also decides whether saving is allowed) */
  analysis: TemplateAnalysis;
  disabled?: boolean;
}

/**
 * The wording editor of one SMS: variable chips, the text, a live preview with example data and
 * the length / segment counter. Used for the confirmation and for the reminder.
 */
export function SmsTemplateEditor({ id, kind, label, value, onChange, analysis, disabled }: SmsTemplateEditorProps) {
  const areaRef = useRef<HTMLTextAreaElement>(null);
  const { info, worst, warn, tooLong, error, rendered } = analysis;
  const defaultText = defaultTemplateFor(kind);

  const insertVariable = (v: SmsVariable) => {
    const el = areaRef.current;
    const token = `{${v}}`;
    if (!el) {
      onChange(`${value}${token}`);
      return;
    }
    const start = el.selectionStart ?? value.length;
    const end = el.selectionEnd ?? value.length;
    onChange(`${value.slice(0, start)}${token}${value.slice(end)}`);
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(start + token.length, start + token.length);
    });
  };

  return (
    <div className={disabled ? "space-y-3 opacity-60" : "space-y-3"}>
      <div className="flex items-center justify-between gap-2">
        <label htmlFor={id} className="text-sm font-semibold text-ink-800">
          {label}
        </label>
        <button
          type="button"
          onClick={() => onChange(defaultText)}
          disabled={disabled || value === defaultText}
          className="flex items-center gap-1 text-xs font-bold text-brand-600 disabled:text-ink-400"
        >
          <RotateCcw className="w-3.5 h-3.5" aria-hidden="true" />
          <span>אפס לברירת מחדל</span>
        </button>
      </div>

      <div className="flex flex-wrap gap-1.5" role="group" aria-label="הוספת משתנה לנוסח">
        {SMS_VARIABLES.map((v) => (
          <button
            key={v}
            type="button"
            disabled={disabled}
            onClick={() => insertVariable(v)}
            className="min-h-[36px] rounded-full border border-ink-200 bg-ink-50 px-3 text-xs font-bold text-ink-800 hover:bg-white"
          >
            {SMS_VARIABLE_LABELS[v]}
            <span className="mr-1 text-ink-500" dir="ltr">{` {${v}}`}</span>
          </button>
        ))}
      </div>

      <textarea
        id={id}
        ref={areaRef}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        rows={4}
        maxLength={SMS_TEMPLATE_MAX_RAW + 60}
        aria-invalid={!!error}
        aria-describedby={`${id}-help`}
        className="w-full rounded-lg border border-ink-200 bg-white p-3 text-base text-ink-900 focus:border-brand-600 focus:outline-none focus:ring-2 focus:ring-brand-600/20"
      />
      <div id={`${id}-help`} className="flex items-center justify-between gap-2 text-xs">
        <span className={cleanTemplateText(value).length > SMS_TEMPLATE_MAX_RAW ? "font-bold text-danger-600" : "text-ink-500"}>
          {cleanTemplateText(value).length}/{SMS_TEMPLATE_MAX_RAW} תווים בנוסח
        </span>
        <span className="text-ink-500">בלי {"{link}"} הקישור יתווסף אוטומטית בסוף</span>
      </div>
      {error && (
        <p role="alert" className="text-xs font-semibold text-danger-600">
          {error}
        </p>
      )}

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
          <div>
            {info.length} תווים בדוגמה · עד {worst.length} תווים במקרה הארוך ביותר
          </div>
          <div>
            {worst.billed <= 1 ? "הודעה אחת" : `ההודעה תיספר כ-${worst.billed} הודעות`}
            {warn && " · הודעה ארוכה עולה יותר. קצרו את הנוסח כדי שתיספר כהודעה אחת"}
            {tooLong && ` · מעל ${SMS_SEGMENTS_MAX} מקטעים אי אפשר לשמור`}
          </div>
        </div>
      </div>
    </div>
  );
}
