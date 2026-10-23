import { randomUUID } from "crypto";
import { getAppointmentById } from "@/lib/db";
import { isSupabaseConfigured, supabaseAdmin } from "./supabase";
import type { FinishPatch, SmsKind, SmsOutboxRow, SmsRepo, SmsStatus } from "@/lib/sms/outbox";

/** Database access for the SMS queue. Supabase in production, memory in local development. */

const COLUMNS = "id, appointment_id, kind, to_phone, status, attempts, next_attempt_at";

interface MockRow extends SmsOutboxRow {
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

export async function insertSmsOutbox(row: {
  appointmentId: string;
  kind: SmsKind;
  toPhone: string;
  status: SmsStatus;
  errorCode?: string;
  errorMessage?: string;
}): Promise<{ id: string } | null> {
  const nowIso = new Date().toISOString();
  const admin = adminClient();
  if (admin) {
    const { data, error } = await admin
      .from("sms_outbox")
      .insert({
        appointment_id: row.appointmentId,
        kind: row.kind,
        to_phone: row.toPhone,
        status: row.status,
        next_attempt_at: nowIso,
        last_error_code: row.errorCode ?? null,
        last_error_message: row.errorMessage ?? null,
      })
      .select("id")
      .maybeSingle();
    // 23505 = unique_violation: this appointment already has a message of this kind
    if (error?.code === "23505") return null;
    if (error) throw error;
    return data ? { id: data.id as string } : null;
  }
  if (mock.some((r) => r.appointment_id === row.appointmentId && r.kind === row.kind)) return null;
  const id = randomUUID();
  mock.push({
    id,
    appointment_id: row.appointmentId,
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
    const { error } = await admin.from("sms_outbox").update(cols).eq("id", id);
    if (error) throw error;
    return;
  }
  const r = mock.find((x) => x.id === id);
  if (r) Object.assign(r, cols);
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

export const smsRepo: SmsRepo = {
  insert: insertSmsOutbox,
  claim: claimSmsOutbox,
  listDue: listDueSms,
  finish: finishSmsOutbox,
  setToken: setSmsManageToken,
  getAppointment: getAppointmentById,
};
