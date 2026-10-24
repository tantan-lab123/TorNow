import type { Client } from "@/lib/types";

/**
 * Search for the "pick an existing customer" box of the manual booking form.
 * Pure functions (no React), so they are easy to test.
 */

/** Phones that stand for "no phone": the quick-add placeholder and the blocked-time client. */
const PLACEHOLDER_PHONES = new Set(["0500000000", "0000000000"]);

/** Digits only, with +972 / 972 / 00972 turned into the local leading 0 (works on partial input too). */
export function normalizePhoneDigits(raw: string): string {
  let d = raw.replace(/\D/g, "");
  if (d.startsWith("00972")) d = d.slice(5);
  else if (d.startsWith("972")) d = d.slice(3);
  else return d;
  return d.startsWith("0") ? d : `0${d}`;
}

/** A phone that stands for "no phone" (the quick-add placeholder, the blocked-time client). */
export function isPlaceholderPhone(phone: string | null | undefined): boolean {
  return PLACEHOLDER_PHONES.has(normalizePhoneDigits(phone ?? ""));
}

/** Placeholder customers ("walk-in", "customer #1a2b") and the blocked-time client are not real customers. */
export function isPlaceholderClient(c: Pick<Client, "phone" | "first_name" | "last_name">): boolean {
  if (PLACEHOLDER_PHONES.has(normalizePhoneDigits(c.phone ?? ""))) return true;
  const first = (c.first_name ?? "").trim();
  const last = (c.last_name ?? "").trim();
  return first === "לקוח" && (last === "מזדמן" || last.startsWith("#"));
}

const normName = (s: string) =>
  s
    .toLowerCase()
    .replace(/[֑-ׇ]/g, "") // niqqud / cantillation
    .replace(/[״"׳'`]/g, "")
    .replace(/\s+/g, " ")
    .trim();

/**
 * Customers matching the query, best first.
 * - digits only: phone search (any common format, +972 or 972 matches 05...)
 * - anything with letters: name search; every word must appear in the first or the last name
 * Order: the customer with the latest appointment first, then by name. No query = everyone, same order.
 * `lastVisit` maps client id -> ISO time of their latest appointment.
 */
export function searchClients<T extends Client>(
  clients: readonly T[],
  query: string,
  lastVisit: ReadonlyMap<string, string> = new Map()
): T[] {
  const real = clients.filter((c) => !isPlaceholderClient(c));
  const q = query.trim();

  let matches = real;
  if (q) {
    const hasLetters = /[^\d\s+\-().]/.test(q);
    if (hasLetters) {
      const words = normName(q).split(" ").filter(Boolean);
      matches = real.filter((c) => {
        const first = normName(c.first_name ?? "");
        const last = normName(c.last_name ?? "");
        return words.every((w) => first.includes(w) || last.includes(w));
      });
    } else {
      const qd = normalizePhoneDigits(q);
      if (qd.length < 2) return [];
      matches = real.filter((c) => {
        const pd = normalizePhoneDigits(c.phone ?? "");
        return pd.includes(qd) || (!qd.startsWith("0") && pd.includes(`0${qd}`));
      });
    }
  }

  return [...matches].sort((a, b) => {
    const ta = lastVisit.get(a.id) ?? "";
    const tb = lastVisit.get(b.id) ?? "";
    if (ta !== tb) return ta < tb ? 1 : -1; // latest first, never-booked last
    const na = `${a.first_name} ${a.last_name}`;
    const nb = `${b.first_name} ${b.last_name}`;
    return na.localeCompare(nb, "he");
  });
}

/** client id -> latest appointment start (cancelled appointments and blocked time don't count). */
export function lastVisitByClient(
  appointments: readonly { client_id?: string | null; start_time: string; status?: string; service_id?: string | null }[]
): Map<string, string> {
  const map = new Map<string, string>();
  for (const a of appointments) {
    if (!a.client_id || a.status === "cancelled" || !a.service_id) continue;
    const cur = map.get(a.client_id);
    if (!cur || a.start_time > cur) map.set(a.client_id, a.start_time);
  }
  return map;
}

/** Local form of a phone for the booking form: "050-1234567" (digits only, +972 / 972 become 0). */
export function formatLocalPhone(raw: string): string {
  const digits = normalizePhoneDigits(raw).slice(0, 10);
  return digits.length > 3 ? `${digits.slice(0, 3)}-${digits.slice(3)}` : digits;
}

/** Same number, whatever the format ("050-1234567", "0501234567", "+972501234567"). */
export function samePhone(a: string, b: string): boolean {
  return normalizePhoneDigits(a) === normalizePhoneDigits(b);
}

/** What the manual-booking form is filled with when a customer is picked. */
export function formFieldsFromClient(c: Pick<Client, "first_name" | "last_name" | "phone">): {
  firstName: string;
  lastName: string;
  phone: string;
} {
  return { firstName: c.first_name, lastName: c.last_name, phone: formatLocalPhone(c.phone) };
}
