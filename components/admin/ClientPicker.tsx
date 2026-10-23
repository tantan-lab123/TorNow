"use client";

import React, { useId, useMemo, useRef, useState } from "react";
import { Search, UserCheck, X } from "lucide-react";
import type { Client } from "@/lib/types";
import { searchClients } from "@/lib/client-search";
import { formatPhone, formatShortDate } from "@/lib/utils";
import { cn } from "@/lib/utils";

const PAGE = 8;

interface ClientPickerProps {
  /** Every customer known to the admin screen (the placeholders are filtered out here). */
  clients: readonly Client[];
  /** client id -> ISO time of their latest appointment */
  lastVisit: ReadonlyMap<string, string>;
  selected: Client | null;
  onSelect: (client: Client) => void;
  onClear: () => void;
}

/**
 * "Pick an existing customer" for the manual booking form. Optional: without a choice the
 * form works exactly as before (new customer / walk-in).
 */
export function ClientPicker({ clients, lastVisit, selected, onSelect, onClear }: ClientPickerProps) {
  const uid = useId();
  const listId = `${uid}-list`;
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [limit, setLimit] = useState(PAGE);

  const results = useMemo(() => searchClients(clients, query, lastVisit), [clients, query, lastVisit]);
  const shown = results.slice(0, limit);
  const hasQuery = query.trim().length > 0;

  const choose = (c: Client) => {
    onSelect(c);
    setQuery("");
    setOpen(false);
    setActive(0);
    setLimit(PAGE);
  };

  const clear = () => {
    onClear();
    // back to the search box, ready for another pick
    setTimeout(() => inputRef.current?.focus(), 0);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (!open) setOpen(true);
      else setActive((i) => Math.min(i + 1, shown.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      // never submit the booking form from the search box
      e.preventDefault();
      if (open && shown[active]) choose(shown[active]);
    } else if (e.key === "Escape") {
      if (open) {
        e.preventDefault();
        setOpen(false);
      }
    }
  };

  if (selected) {
    return (
      <div>
        <span className="block text-sm font-semibold text-ink-800 mb-1.5">לקוח קיים</span>
        <div className="flex items-center gap-3 rounded-lg border border-brand-600/30 bg-brand-50 px-3 py-2.5">
          <UserCheck className="h-5 w-5 shrink-0 text-brand-600" aria-hidden="true" />
          <div className="min-w-0 flex-1 text-right">
            <div className="truncate text-sm font-bold text-ink-900">
              {selected.first_name} {selected.last_name}
            </div>
            <div className="text-xs text-ink-600" dir="ltr" style={{ textAlign: "right" }}>
              {formatPhone(selected.phone)}
            </div>
          </div>
          <button
            type="button"
            onClick={clear}
            aria-label="נקה את בחירת הלקוח"
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-ink-500 hover:bg-white hover:text-ink-800"
          >
            <X className="h-5 w-5" aria-hidden="true" />
          </button>
        </div>
      </div>
    );
  }

  const activeId = open && shown[active] ? `${uid}-opt-${shown[active].id}` : undefined;

  return (
    <div
      className="text-right"
      onBlur={(e) => {
        // close when focus leaves the whole picker (a tap inside the list keeps it open)
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOpen(false);
      }}
    >
      <label htmlFor={`${uid}-input`} className="block text-sm font-semibold text-ink-800 mb-1.5">
        לקוח קיים (אופציונלי)
      </label>
      <div className="relative">
        <Search
          className="pointer-events-none absolute right-3 top-1/2 h-5 w-5 -translate-y-1/2 text-ink-400"
          aria-hidden="true"
        />
        <input
          ref={inputRef}
          id={`${uid}-input`}
          type="text"
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={activeId}
          autoComplete="off"
          placeholder="חיפוש לפי שם או טלפון"
          value={query}
          onFocus={() => setOpen(true)}
          onChange={(e) => {
            setQuery(e.target.value);
            setActive(0);
            setLimit(PAGE);
            setOpen(true);
          }}
          onKeyDown={onKeyDown}
          className={cn(
            "flex h-12 w-full rounded-lg border border-ink-200 bg-white pr-10 pl-4 py-3 text-base text-ink-900 placeholder:text-ink-400 transition-colors",
            "focus:border-brand-600 focus:outline-none focus:ring-2 focus:ring-brand-600/20"
          )}
        />
      </div>

      {open && (
        <div className="mt-1.5 rounded-lg border border-ink-200 bg-white">
          {shown.length > 0 ? (
            <>
              <ul id={listId} role="listbox" aria-label="לקוחות" className="max-h-64 overflow-y-auto py-1">
                {shown.map((c, i) => {
                  const visit = lastVisit.get(c.id);
                  return (
                    <li
                      key={c.id}
                      id={`${uid}-opt-${c.id}`}
                      role="option"
                      aria-selected={i === active}
                      onMouseEnter={() => setActive(i)}
                      // mousedown, so the choice lands before the input loses focus
                      onMouseDown={(e) => {
                        e.preventDefault();
                        choose(c);
                      }}
                      className={cn(
                        "flex cursor-pointer items-center justify-between gap-3 px-3 py-2.5 text-right",
                        i === active ? "bg-brand-50" : "bg-white"
                      )}
                    >
                      <div className="min-w-0">
                        <div className="truncate text-sm font-bold text-ink-900">
                          {c.first_name} {c.last_name}
                        </div>
                        {visit && <div className="text-xs text-ink-500">תור אחרון: {formatShortDate(visit)}</div>}
                      </div>
                      <span className="shrink-0 text-sm text-ink-700" dir="ltr">
                        {formatPhone(c.phone)}
                      </span>
                    </li>
                  );
                })}
              </ul>
              {results.length > shown.length && (
                <button
                  type="button"
                  onClick={() => setLimit((l) => l + PAGE)}
                  className="w-full border-t border-ink-100 py-2.5 text-sm font-bold text-brand-600 hover:bg-ink-50"
                >
                  הצג עוד ({results.length - shown.length})
                </button>
              )}
            </>
          ) : (
            <p id={listId} role="status" className="px-3 py-3 text-sm text-ink-600">
              {hasQuery
                ? "לא נמצא לקוח. אפשר להמשיך ולמלא את הפרטים למטה כלקוח חדש."
                : "אין עדיין לקוחות. מלאו את הפרטים למטה כלקוח חדש."}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
