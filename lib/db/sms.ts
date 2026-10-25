import { randomUUID } from "crypto";
import { getAppointmentById, getAppointments, getBusinessById, getBusinesses } from "@/lib/db";
import { israelMonthStartIso } from "@/lib/sms/usage";
import { isSupabaseConfigured, supabaseAdmin } from "./supabase";
import type { FinishPatch, SmsKind, SmsOutboxRow, SmsRepo, SmsStatus } from "@/lib/sms/outbox";
import type { CountOptions } from "@/lib/sms/limits";
import { normalizeReminderMinutes } from "@/lib/sms/message";
import {
  reminderKey,
  type ReminderBusiness,
  type ReminderCandidate,
  type ReminderRepo,
} from "@/lib/sms/reminders";

/** Database access for the SMS queue. Supabase in production, memory in local development. */

const COLUMNS = "id, appointment_id, kind, to_phone, status, attempts, next_attempt_at, created_at";

interface MockRow extends SmsOutboxRow {
  business_id: string | null;
  segments: number | null;
  billed_messages: number | null;
  for_start_time: string | null;
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
 * business_id, segments and billed_messages came with later migrations. Until it has run, the database says the
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
  /** Reminders only: the appointment start the reminder is for */
  forStartTime?: string | null;
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
    // for_start_time only exists with the reminders migration, and only reminders need it: the
    // confirmation rows are written exactly as before, so they keep working until it has run.
    const withStart = row.kind === "reminder" ? { for_start_time: row.forStartTime ?? null } : {};
    let res = await admin
      .from("sms_outbox")
      .insert({ ...base, ...withStart, business_id: row.businessId ?? null })
      .select("id")
      .maybeSingle();
    if (isMissingColumnError(res.error) && row.kind !== "reminder") {
      res = await admin.from("sms_outbox").insert(base).select("id").maybeSingle();
    }
    // 23505 = unique_violation: this appointment already has a message of this kind
    // (a reminder: already one for this appointment time)
    if (res.error?.code === "23505") return null;
    if (res.error) throw res.error;
    return res.data ? { id: res.data.id as string } : null;
  }
  const startMs = row.forStartTime ? new Date(row.forStartTime).getTime() : null;
  const exists =
    row.kind === "reminder"
      ? mock.some(
          (r) =>
            r.appointment_id === row.appointmentId &&
            r.kind === "reminder" &&
            r.for_start_time &&
            new Date(r.for_start_time).getTime() === startMs
        )
      : mock.some((r) => r.appointment_id === row.appointmentId && r.kind === row.kind);
  if (exists) return null;
  const id = randomUUID();
  mock.push({
    id,
    appointment_id: row.appointmentId,
    business_id: row.businessId ?? null,
    segments: null,
    billed_messages: null,
    for_start_time: row.kind === "reminder" ? (row.forStartTime ?? null) : null,
    created_at: nowIso,
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
 * Atomic claim: compare-and-swap on the attempt counter, so when the after() task and the
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
  const segmentCols = patch.segments !== undefined ? { segments: patch.segments } : {};
  const billedCols = patch.billedMessages !== undefined ? { billed_messages: patch.billedMessages } : {};
  if (admin) {
    // segments and billed_messages came with two different migrations. If a column is unknown the update is
    // repeated without the newest one first, then without both, so a sent message is always recorded as sent.
    const attempts: Record<string, unknown>[] = [{ ...cols, ...segmentCols, ...billedCols }];
    if (patch.billedMessages !== undefined) attempts.push({ ...cols, ...segmentCols });
    if (patch.segments !== undefined) attempts.push(cols);
    let error: { code?: string; message?: string } | null = null;
    for (const payload of attempts) {
      ({ error } = await admin.from("sms_outbox").update(payload).eq("id", id));
      if (!isMissingColumnError(error)) break;
    }
    if (error) throw error;
    return;
  }
  const r = mock.find((x) => x.id === id);
  if (r) Object.assign(r, cols, segmentCols, billedCols);
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
  /** Messages 019 bills for them (billed_messages; a sent row without the number counts 1). The number the owner sees. */
  billed: number;
  /** Their SMS segments (rows from before the segments column count as 0): a technical number only */
  segments: number;
  /** How many of them were confirmations and how many reminders */
  byKind: { booked: number; reminder: number };
  /** Start of the counted month (Israel time), ISO */
  since: string;
}

/** A sent row without a stored number (sent before billed_messages existed, or the column was missing) is one billed message. */
const billedOf = (n: number | null | undefined) => n ?? 1;

/** This business's SMS usage from the start of the current Israeli calendar month. */
export async function getSmsUsage(businessId: string, now: Date = new Date()): Promise<SmsUsage> {
  const since = israelMonthStartIso(now);
  const admin = adminClient();
  if (admin) {
    let sent = 0;
    let billed = 0;
    let segments = 0;
    const byKind = { booked: 0, reminder: 0 };
    const PAGE = 1000;
    let columns = "billed_messages, segments, kind";
    for (let from = 0; ; from += PAGE) {
      const page = () =>
        admin
          .from("sms_outbox")
          .select(columns)
          .eq("business_id", businessId)
          .eq("status", "sent")
          .gte("created_at", since)
          .order("created_at", { ascending: true })
          .order("id", { ascending: true })
          .range(from, from + PAGE - 1);
      let { data, error } = await page();
      // billed_messages may not exist yet (migration not run): read without it, every row then counts 1
      if (isMissingColumnError(error)) {
        columns = "segments, kind";
        ({ data, error } = await page());
      }
      if (error) throw error;
      for (const r of (data ?? []) as unknown as { billed_messages?: number | null; segments: number | null; kind: string }[]) {
        sent += 1;
        billed += billedOf(r.billed_messages);
        segments += r.segments ?? 0;
        if (r.kind === "reminder") byKind.reminder += 1;
        else byKind.booked += 1;
      }
      if (!data || data.length < PAGE) break;
    }
    return { sent, billed, segments, byKind, since };
  }
  const rows = mock.filter((r) => r.business_id === businessId && r.status === "sent");
  return {
    sent: rows.length,
    billed: rows.reduce((n, r) => n + billedOf(r.billed_messages), 0),
    segments: rows.reduce((n, r) => n + (r.segments ?? 0), 0),
    byKind: {
      booked: rows.filter((r) => r.kind !== "reminder").length,
      reminder: rows.filter((r) => r.kind === "reminder").length,
    },
    since,
  };
}

/**
 * Messages to this phone created since sinceIso with status pending or sent (skipped and failed
 * ones do not count). The per-phone abuse limits are decided from this, in the database, so every
 * server instance sees the same numbers.
 */
export async function countRecentByPhone(phone: string, sinceIso: string, opts: CountOptions = {}): Promise<number> {
  const admin = adminClient();
  if (admin) {
    let q = admin
      .from("sms_outbox")
      .select("id", { count: "exact", head: true })
      .eq("to_phone", phone)
      .in("status", ["pending", "sent"])
      .gte("created_at", sinceIso);
    if (opts.excludeId) q = q.neq("id", opts.excludeId);
    if (opts.createdUpToIso) q = q.lte("created_at", opts.createdUpToIso);
    const { count, error } = await q;
    if (error) throw error;
    return count ?? 0;
  }
  return mock.filter(
    (r) =>
      r.to_phone === phone &&
      (r.status === "pending" || r.status === "sent") &&
      r.created_at >= sinceIso &&
      r.id !== opts.excludeId &&
      (!opts.createdUpToIso || r.created_at <= opts.createdUpToIso)
  ).length;
}

/** The appointment start a reminder row was made for. */
export async function getReminderStart(id: string): Promise<string | null> {
  const admin = adminClient();
  if (admin) {
    const { data, error } = await admin.from("sms_outbox").select("for_start_time").eq("id", id).maybeSingle();
    if (error) throw error;
    return (data?.for_start_time as string | null | undefined) ?? null;
  }
  return mock.find((r) => r.id === id)?.for_start_time ?? null;
}

// ---------------------------------------------------------------- reminders (the planner's reads)

const IDS_PER_REQUEST = 150; // appointment ids per request (keeps the URL short)

export const reminderRepo: ReminderRepo = {
  async listReminderBusinesses(): Promise<ReminderBusiness[]> {
    const admin = adminClient();
    if (admin) {
      // Only the one setting is read (the settings can hold large images). If the database does not
      // understand the path, fall back to reading the businesses whole.
      const { data, error } = await admin
        .from("businesses")
        .select("id, slug, minutes:working_hours->_settings->>sms_reminder_minutes");
      if (!error && data) {
        return (data as unknown as { id: string; slug: string; minutes: string | number | null }[]).map((b) => ({
          id: b.id,
          slug: b.slug,
          minutes: normalizeReminderMinutes(b.minutes),
        }));
      }
    }
    const all = await getBusinesses();
    return all.map((b) => ({
      id: b.id,
      slug: b.slug,
      minutes: normalizeReminderMinutes(b.settings?.sms_reminder_minutes),
    }));
  },

  async listReminderCandidates({ businessIds, startAfterIso, startBeforeIso, limit }): Promise<ReminderCandidate[]> {
    const admin = adminClient();
    if (admin) {
      const { data, error } = await admin
        .from("appointments")
        .select("id, business_id, start_time, created_at, client:clients(phone)")
        .in("business_id", businessIds)
        .eq("status", "confirmed")
        .not("service_id", "is", null) // blocked time has no service
        .gt("start_time", startAfterIso)
        .lte("start_time", startBeforeIso)
        .order("start_time", { ascending: true })
        .limit(limit);
      if (error) throw error;
      type Row = {
        id: string;
        business_id: string;
        start_time: string;
        created_at: string;
        client: { phone?: string } | { phone?: string }[] | null;
      };
      return ((data ?? []) as unknown as Row[]).map((r) => {
        const client = Array.isArray(r.client) ? r.client[0] : r.client;
        return {
          id: r.id,
          business_id: r.business_id,
          start_time: r.start_time,
          created_at: r.created_at,
          phone: client?.phone ?? null,
        };
      });
    }
    const out: ReminderCandidate[] = [];
    for (const businessId of businessIds) {
      const rows = await getAppointments(businessId, startAfterIso);
      for (const a of rows) {
        if (a.status !== "confirmed" || !a.service_id) continue;
        if (a.start_time <= startAfterIso || a.start_time > startBeforeIso) continue;
        out.push({
          id: a.id,
          business_id: a.business_id,
          start_time: a.start_time,
          created_at: a.created_at ?? a.start_time,
          phone: a.client?.phone ?? null,
        });
      }
    }
    return out.sort((x, y) => x.start_time.localeCompare(y.start_time)).slice(0, limit);
  },

  async existingReminderKeys(appointmentIds: string[]): Promise<Set<string>> {
    const keys = new Set<string>();
    const admin = adminClient();
    if (admin) {
      for (let i = 0; i < appointmentIds.length; i += IDS_PER_REQUEST) {
        const { data, error } = await admin
          .from("sms_outbox")
          .select("appointment_id, for_start_time")
          .eq("kind", "reminder")
          .in("appointment_id", appointmentIds.slice(i, i + IDS_PER_REQUEST));
        if (error) throw error;
        for (const r of (data ?? []) as { appointment_id: string; for_start_time: string | null }[]) {
          if (r.for_start_time) keys.add(reminderKey(r.appointment_id, r.for_start_time));
        }
      }
      return keys;
    }
    for (const r of mock) {
      if (r.kind === "reminder" && r.for_start_time && appointmentIds.includes(r.appointment_id)) {
        keys.add(reminderKey(r.appointment_id, r.for_start_time));
      }
    }
    return keys;
  },
};

export const smsRepo: SmsRepo = {
  insert: insertSmsOutbox,
  claim: claimSmsOutbox,
  listDue: listDueSms,
  finish: finishSmsOutbox,
  setToken: setSmsManageToken,
  getAppointment: getAppointmentById,
  getReminderStart,
  countRecentByPhone,
  getBusiness: getBusinessById,
};
