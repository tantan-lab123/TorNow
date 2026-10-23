import { TZDate } from "@date-fns/tz";

/**
 * 019 delivery reports (DLR).
 *   0, 102 -> reached the handset
 *   -1     -> sent, but the operator gives no delivery confirmation
 *   others -> failed / not delivered (1-7, 14-18, 101, 103-132, 201, 747, 998, 999, ...)
 */
export type DlrOutcome = "delivered" | "sent_unconfirmed" | "failed";

export interface ParsedDlr {
  /** The raw code, exactly as stored in sms_outbox.delivery_status. */
  rawCode: string;
  outcome: DlrOutcome;
}

export function parseDlrStatus(raw: unknown): ParsedDlr | null {
  if (typeof raw !== "string" && typeof raw !== "number") return null;
  const text = String(raw).trim();
  if (!/^-?\d{1,4}$/.test(text)) return null;
  const code = Number(text);
  const outcome: DlrOutcome =
    code === 0 || code === 102 ? "delivered" : code === -1 ? "sent_unconfirmed" : "failed";
  return { rawCode: String(code), outcome };
}

/** 019 sends "dd/mm/yy hh:mm" in Israel time. Falls back to null when it can't be read. */
export function parseDlrDate(raw: unknown): Date | null {
  if (typeof raw !== "string") return null;
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})\s+(\d{1,2}):(\d{2})$/.exec(raw.trim());
  if (!m) return null;
  const [, d, mo, y, h, mi] = m;
  const year = y.length === 2 ? 2000 + Number(y) : Number(y);
  const date = new TZDate(year, Number(mo) - 1, Number(d), Number(h), Number(mi), 0, 0, "Asia/Jerusalem");
  return Number.isNaN(date.getTime()) ? null : new Date(date.getTime());
}

export interface DlrState {
  deliveryStatus: string | null;
  deliveredAt: string | null;
}

/**
 * What the row should look like after a report arrives. Reports can come late or twice:
 * a row that is already "delivered" never goes back to "sent" or "failed", and the same
 * report applied twice changes nothing.
 */
export function applyDlr(current: DlrState, incoming: ParsedDlr, reportedAt: Date): DlrState {
  if (current.deliveredAt) return current;
  if (incoming.outcome === "delivered") {
    return { deliveryStatus: incoming.rawCode, deliveredAt: reportedAt.toISOString() };
  }
  return { deliveryStatus: incoming.rawCode, deliveredAt: null };
}
