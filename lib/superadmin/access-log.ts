import { signForDomain } from "@/lib/auth";
import { isSupabaseConfigured, supabaseAdmin } from "@/lib/db/supabase";
import { ACCESS_LOG_HASH_DOMAIN } from "@/lib/superadmin/config";

/**
 * The access log of /superadmin: every successful and every rejected sign-in attempt.
 * A success keeps the e-mail (it is the owner's own). A rejected attempt keeps only a KEYED HASH of the
 * e-mail (when there is one) and the reason, never the e-mail and never the token. The address of the
 * visitor is only ever stored as a keyed hash.
 */

export interface AccessEntry {
  success: boolean;
  /** Only for a success */
  email?: string;
  /** Only for a rejected attempt whose token had an e-mail */
  rejectedEmail?: string;
  reason?: "bad_token" | "not_allowed";
  ip: string;
}

export interface AccessRow {
  success: boolean;
  email: string | null;
  email_hash: string | null;
  reason: string | null;
  ip_hash: string | null;
}

/** Keyed hash: the same input gives the same output on this server, and nobody can reverse or guess it without the key. */
export function keyedHash(value: string): string {
  return signForDomain(ACCESS_LOG_HASH_DOMAIN, value.trim().toLowerCase());
}

export function toAccessRow(e: AccessEntry): AccessRow {
  return {
    success: e.success,
    email: e.success ? (e.email?.trim().toLowerCase() ?? null) : null,
    email_hash: !e.success && e.rejectedEmail ? keyedHash(e.rejectedEmail) : null,
    reason: e.success ? null : (e.reason ?? "bad_token"),
    ip_hash: e.ip ? keyedHash(e.ip) : null,
  };
}

declare global {
  var __ADMIN_ACCESS_LOG__: AccessRow[] | undefined;
}

/** Never throws: a log problem must not decide who gets in. */
export async function logAccess(entry: AccessEntry): Promise<void> {
  try {
    const row = toAccessRow(entry);
    if (isSupabaseConfigured && supabaseAdmin) {
      const { error } = await supabaseAdmin.from("admin_access_log").insert(row);
      if (error) throw error;
      return;
    }
    (globalThis.__ADMIN_ACCESS_LOG__ ??= []).push(row);
  } catch (err) {
    console.error("superadmin access log failed:", err instanceof Error ? err.name : "unknown");
  }
}
