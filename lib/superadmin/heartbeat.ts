import { isSupabaseConfigured, supabaseAdmin } from "@/lib/db/supabase";
import type { Heartbeat } from "@/lib/superadmin/metrics";

/**
 * "The job ran just now": a row per cron job in cron_heartbeat, for the operator dashboard.
 * It is bookkeeping only: it never throws, so it can never affect the job that writes it. If the table does
 * not exist yet (the migration has not been run) it logs the error name and carries on.
 */

declare global {
  var __CRON_HEARTBEAT__: Record<string, Heartbeat> | undefined;
}

export async function recordHeartbeat(job: string, ok: boolean, detail?: string | null): Promise<void> {
  try {
    const row = { job, last_run_at: new Date().toISOString(), ok, detail: detail ? detail.slice(0, 200) : null };
    if (isSupabaseConfigured && supabaseAdmin) {
      const { error } = await supabaseAdmin.from("cron_heartbeat").upsert(row, { onConflict: "job" });
      if (error) throw error;
      return;
    }
    (globalThis.__CRON_HEARTBEAT__ ??= {})[job] = row;
  } catch (err) {
    console.error("cron heartbeat not written:", err instanceof Error ? err.name : "unknown");
  }
}

export function memoryHeartbeats(): Record<string, Heartbeat> {
  return globalThis.__CRON_HEARTBEAT__ ?? {};
}
