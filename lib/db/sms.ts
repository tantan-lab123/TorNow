import { randomUUID } from "crypto";
import { getAppointmentById, getBusinessById } from "@/lib/db";
import { israelMonthStartIso } from "@/lib/sms/usage";
import { isSupabaseConfigured, supabaseAdmin } from "./supabase";
import type { FinishPatch, SmsKind, SmsOutboxRow, SmsRepo, SmsStatus } from "@/lib/sms/outbox";

/** Database access for the SMS queue. Supabase in production, memory in local development. */

const COLUMNS = "id, appointment_id, kind, to_phone, status, attempts, next_attempt_at";

interface MockRow extends SmsOutboxRow {
  business_id: string | null;
  segments: number | null;
  last_error_code: string | null;
  last_error_message: string | null;
  provider_shipment_id: string | null;
  delivery_status: string | null;
  delivered_at: string | null;
  manage_token_hash: string | null;
  manage_token_expires_at: string | null;
}

declare global {
  var __SMS_OUTBOX__: MockRow[] | undefined;
}
const mock = (globalThis.__SMS_OUTBOX__ ??= []);

const adminClient = () => (isSupabaseConfigured && supabaseAdmin ? supabaseAdmin : null);

/**
 * business_id and segments came with a later migration. Until it has run, the database says the
 * column is unknown (PostgREST: PGRST204, Postgres: 42703): then the write is repeated without
 * them, so confirmations keep going out. A safety net, not the plan: run the migration first.
 */
export function isMissingColumnError(error: { code?: string; message?: string } | null | undefined): boolean {
  if (!error) return false;
  return error.code === "PGRST204" || error.code === "42703";
}

export async function insertSmsOutbox(row: {
  appointmentId: string;
  businessId?: string | null;
  kind: SmsKind;
  toPhone: string;
  status: SmsStatus;
  errorCode?: string;
  errorMessage?: string;
}): Promise<{ id: string } | null> {
  const nowIso = new Date().toISOString();
  const admin = adminClient();
  if (admin) {
    const base = {
      appointment_id: row.appointmentId,
      kind: row.kind,
      to_phone: row.toPhone,
      status: row.status,
      next_attempt_at: nowIso,
      last_error_code: row.errorCode ?? null,
      last_error_message: row.errorMessage ?? null,
    };
    let res = await admin
      .from("sms_outbox")
      .insert({ ...base, business_id: row.businessId ?? null })
      .select("id")
      .maybeSingle();
    if (isMissingColumnError(res.error)) {
      res = await admin.from("sms_outbox").insert(base).select("id").maybeSingle();
    }
    // 23505 = unique_violation: this appointment already has a message of this kind
    if (res.error?.code === "23505") return null;
    if (res.error) throw res.error;
    return res.data ? { id: res.data.id as string } : null;
  }
  if (mock.some((r) => r.appointment_id === row.appointmentId && r.kind === row.kind)) return null;
  const id = randomUUID();
  mock.push({
    id,
    appointment_id: row.appointmentId,
    business_id: row.businessId ?? null,
    segments: null,
    kind: row.kind,
    to_phone: row.toPhone,
    status: row.status,
    attempts: 0,
    next_attempt_at: nowIso,
    last_error_code: row.errorCode ?? null,
    last_error_message: row.errorMessage ?? null,
    provider_shipment_id: null,
    delivery_status: null,
    delivered_at: null,
    manage_token_hash: null,
    manage_token_expires_at: null,
  });
  return { id };
}

/**
 * Atomic claim: compare-and-swap on the attempt counter, so when the `after()` task and the
 * cron job race for the same row exactly one of them wins and the other sees null.
 */
export async function claimSmsOutbox(id: string, nowIso: string, leaseUntilIso: string): Promise<SmsOutboxRow | null> {
  const admin = adminClient();
  if (admin) {
    const { data: cur, error: readErr } = await admin
      .from("sms_outbox")
      .select(COLUMNS)
      .eq("id", id)
      .eq("status", "pending")
      .lte("next_attempt_at", nowIso)
      .maybeSingle();
    if (readErr) throw readErr;
    if (!cur) return null;
    const { data, error } = await admin
      .from("sms_outbox")
      .update({ attempts: cur.attempts + 1, next_attempt_at: leaseUntilIso, updated_at: nowIso })
      .eq("id", id)
      .eq("status", "pending")
      .eq("attempts", cur.attempts)
      .select(COLUMNS)
      .maybeSingle();
    if (error) throw error;
    return (data as SmsOutboxRow) ?? null;
  }
  const r = mock.find((x) => x.id === id);
  if (!r || r.status !== "pending" || r.next_attempt_at > nowIso) return null;
  r.attempts += 1;
  r.next_attempt_at = leaseUntilIso;
  return { ...r };
}

export async function listDueSms(nowIso: string, limit: number): Promise<string[]> {
  const admin = adminClient();
  if (admin) {
    const { data, error } = await admin
      .from("sms_outbox")
      .select("id")
      .eq("status", "pending")
      .lte("next_attempt_at", nowIso)
      .order("next_attempt_at", { ascending: true })
      .limit(limit);
    if (error) throw error;
    return (data ?? []).map((r: { id: string }) => r.id);
  }
  return mock
    .filter((r) => r.status === "pending" && r.next_attempt_at <= nowIso)
    .sort((a, b) => a.next_attempt_at.localeCompare(b.next_attempt_at))
    .slice(0, limit)
    .map((r) => r.id);
}

export async function finishSmsOutbox(id: string, patch: FinishPatch): Promise<void> {
  const cols: Record<string, unknown> = { status: patch.status, updated_at: new Date().toISOString() };
  if (patch.nextAttemptAt !== undefined) cols.next_attempt_at = patch.nextAttemptAt;
  if (patch.errorCode !== undefined) cols.last_error_code = patch.errorCode;
  if (patch.errorMessage !== undefined) cols.last_error_message = patch.errorMessage;
  if (patch.shipmentId !== undefined) cols.provider_shipment_id = patch.shipmentId;
  const admin = adminClient();
  if (admin) {
    let { error } = await admin
      .from("sms_outbox")
      .update(patch.segments !== undefined ? { ...cols, segments: patch.segments } : cols)
      .eq("id", id);
    // the segments column may not exist yet (migration not run): the update is repeated without it
    if (patch.segments !== undefined && isMissingColumnError(error)) {
      ({ error } = await admin.from("sms_outbox").update(cols).eq("id", id));
    }
    if (error) throw error;
    return;
  }
  const r = mock.find((x) => x.id === id);
  if (r) Object.assign(r, cols, patch.segments !== undefined ? { segments: patch.segments } : {});
}

export async function setSmsManageToken(id: string, hash: string, expiresAtIso: string): Promise<void> {
  const admin = adminClient();
  if (admin) {
    const { error } = await admin
      .from("sms_outbox")
      .update({ manage_token_hash: hash, manage_token_expires_at: expiresAtIso })
      .eq("id", id);
    if (error) throw error;
    return;
  }
  const r = mock.find((x) => x.id === id);
  if (r) {
    r.manage_token_hash = hash;
    r.manage_token_expires_at = expiresAtIso;
  }
}

/** An appointment moved: the link stays valid until the end of the new time. */
export async function extendSmsManageTokens(appointmentId: string, expiresAtIso: string): Promise<void> {
  const admin = adminClient();
  if (admin) {
    const { error } = await admin
      .from("sms_outbox")
      .update({ manage_token_expires_at: expiresAtIso })
      .eq("appointment_id", appointmentId)
      .not("manage_token_hash", "is", null);
    if (error) throw error;
    return;
  }
  for (const r of mock) {
    if (r.appointment_id === appointmentId && r.manage_token_hash) r.manage_token_expires_at = expiresAtIso;
  }
}

export interface ManageTokenLookup {
  appointmentId: string;
  expiresAt: string | null;
}

export async function findSmsByTokenHash(hash: string): Promise<ManageTokenLookup | null> {
  const admin = adminClient();
  if (admin) {
    const { data, error } = await admin
      .from("sms_outbox")
      .select("appointment_id, manage_token_expires_at")
      .eq("manage_token_hash", hash)
      .maybeSingle();
    if (error) throw error;
    return data ? { appointmentId: data.appointment_id, expiresAt: data.manage_token_expires_at } : null;
  }
  const r = mock.find((x) => x.manage_token_hash === hash);
  return r ? { appointmentId: r.appointment_id, expiresAt: r.manage_token_expires_at } : null;
}

/**
 * Delivery report. Returns false when the row is unknown. A row that is already delivered is
 * never touched again (a late "sent" or "failed" must not undo it).
 */
export async function recordSmsDelivery(
  id: string,
  rawCode: string,
  deliveredAtIso: string | null
): Promise<boolean> {
  const admin = adminClient();
  if (admin) {
    const { data, error } = await admin
      .from("sms_outbox")
      .update({
        delivery_status: rawCode,
        ...(deliveredAtIso ? { delivered_at: deliveredAtIso } : {}),
        updated_at: new Date().toISOString(),
      })
      .eq("id", id)
      .is("delivered_at", null)
      .select("id");
    if (error) throw error;
    return (data?.length ?? 0) > 0;
  }
  const r = mock.find((x) => x.id === id);
  if (!r || r.delivered_at) return false;
  r.delivery_status = rawCode;
  if (deliveredAtIso) r.delivered_at = deliveredAtIso;
  return true;
}

export interface SmsUsage {
  /** Messages handed to the provider this month (status "sent"; skipped and failed ones don't count) */
  sent: number;
  /** Their SMS segments (rows from before the segments column count as 0) */
  segments: number;
  /** Start of the counted month (Israel time), ISO */
  since: string;
}

/** This business's SMS usage from the start of the current Israeli calendar month. */
export async function getSmsUsage(businessId: string, now: Date = new Date()): Promise<SmsUsage> {
  const since = israelMonthStartIso(now);
  const admin = adminClient();
  if (admin) {
    let sent = 0;
    let segments = 0;
    const PAGE = 1000;
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await admin
        .from("sms_outbox")
        .select("segments")
        .eq("business_id", businessId)
        .eq("status", "sent")
        .gte("created_at", since)
        .order("created_at", { ascending: true })
        .order("id", { ascending: true })
        .range(from, from + PAGE - 1);
      if (error) throw error;
      for (const r of (data ?? []) as { segments: number | null }[]) {
        sent += 1;
        segments += r.segments ?? 0;
      }
      if (!data || data.length < PAGE) break;
    }
    return { sent, segments, since };
  }
  const rows = mock.filter((r) => r.business_id === businessId && r.status === "sent");
  return { sent: rows.length, segments: rows.reduce((n, r) => n + (r.segments ?? 0), 0), since };
}

export const smsRepo: SmsRepo = {
  insert: insertSmsOutbox,
  claim: claimSmsOutbox,
  listDue: listDueSms,
  finish: finishSmsOutbox,
  setToken: setSmsManageToken,
  getAppointment: getAppointmentById,
  getBusiness: getBusinessById,
};
