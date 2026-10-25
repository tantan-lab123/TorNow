"use client";

import React, { useMemo, useState } from "react";
import type { BusinessLine } from "@/lib/superadmin/metrics";
import { formatDateTime, formatNumber } from "@/components/superadmin/format";

type Key = "name" | "createdAt" | "appts30d" | "smsSent30d" | "billed30d" | "segments30d" | "smsFailed30d" | "lastAppointmentAt";

const COLUMNS: { key: Key; label: string; numeric: boolean }[] = [
  { key: "name", label: "עסק", numeric: false },
  { key: "createdAt", label: "נרשם", numeric: false },
  { key: "appts30d", label: "תורים (30 יום)", numeric: true },
  { key: "smsSent30d", label: "SMS (30 יום)", numeric: true },
  { key: "billed30d", label: "הודעות לחיוב", numeric: true },
  { key: "segments30d", label: "מקטעים", numeric: true },
  { key: "smsFailed30d", label: "SMS שנכשלו", numeric: true },
  { key: "lastAppointmentAt", label: "תור אחרון", numeric: false },
];

/** The businesses by use. Sorted in the browser (the rows are already in), a click on a header sorts by it. */
export function BusinessTable({ rows }: { rows: BusinessLine[] }) {
  const [sort, setSort] = useState<{ key: Key; dir: "asc" | "desc" }>({ key: "appts30d", dir: "desc" });

  const sorted = useMemo(() => {
    const list = [...rows];
    const { key, dir } = sort;
    const val = (r: BusinessLine) => r[key] ?? "";
    list.sort((a, b) => {
      const x = val(a);
      const y = val(b);
      const c = typeof x === "number" && typeof y === "number" ? x - y : String(x).localeCompare(String(y), "he");
      return dir === "asc" ? c : -c;
    });
    return list;
  }, [rows, sort]);

  return (
    <div
      role="region"
      aria-label="עסקים לפי שימוש"
      tabIndex={0}
      className="relative overflow-x-auto rounded-lg border border-ink-200 bg-white focus-visible:outline-2 focus-visible:outline-offset-2"
    >
      <table className="w-full min-w-[760px] border-collapse text-right text-[14px]">
        <caption className="sr-only">עסקים לפי שימוש</caption>
        <thead>
          <tr className="border-b border-ink-200 bg-ink-50">
            {COLUMNS.map((c) => {
              const active = sort.key === c.key;
              return (
                <th
                  key={c.key}
                  scope="col"
                  aria-sort={active ? (sort.dir === "asc" ? "ascending" : "descending") : "none"}
                  className="px-3 py-2"
                >
                  <button
                    type="button"
                    className="inline-flex min-h-11 items-center gap-1 font-bold text-ink-800"
                    onClick={() => setSort({ key: c.key, dir: active && sort.dir === "desc" ? "asc" : "desc" })}
                  >
                    {c.label}
                    <span aria-hidden="true" className="text-ink-600">
                      {active ? (sort.dir === "asc" ? "▲" : "▼") : ""}
                    </span>
                  </button>
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {sorted.map((r) => (
            <tr key={r.slug} className="border-b border-ink-100 last:border-b-0">
              <th scope="row" className="px-3 py-2.5 font-semibold text-ink-900">
                {r.name}
                {r.isDemo && (
                  <span className="mr-2 rounded bg-ink-100 px-1.5 py-0.5 text-[12px] font-bold text-ink-700">דמו</span>
                )}
                <span className="block text-[12px] font-normal text-ink-600" dir="ltr" style={{ textAlign: "right" }}>
                  {r.slug}
                </span>
              </th>
              <td className="px-3 py-2.5">{formatDateTime(r.createdAt, true)}</td>
              <td className="px-3 py-2.5 tabular-nums">{formatNumber(r.appts30d)}</td>
              <td className="px-3 py-2.5 tabular-nums">{formatNumber(r.smsSent30d)}</td>
              <td className="px-3 py-2.5 font-bold tabular-nums">{formatNumber(r.billed30d)}</td>
              <td className="px-3 py-2.5 tabular-nums text-ink-600">{formatNumber(r.segments30d)}</td>
              <td className="px-3 py-2.5 tabular-nums">{formatNumber(r.smsFailed30d)}</td>
              <td className="px-3 py-2.5">{r.lastAppointmentAt ? formatDateTime(r.lastAppointmentAt, true) : "—"}</td>
            </tr>
          ))}
          {sorted.length === 0 && (
            <tr>
              <td colSpan={COLUMNS.length} className="px-3 py-6 text-center text-ink-700">
                אין עסקים עדיין.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
