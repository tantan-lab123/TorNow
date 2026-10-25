import { beforeEach, describe, expect, it, vi } from "vitest";

// The real recordHeartbeat, against a database client that can be made to fail (as when the table is missing).
const state = vi.hoisted(() => ({ upserts: [] as { row: Record<string, unknown>; opts: unknown }[], error: null as { code: string; message: string } | null }));

vi.mock("@/lib/db/supabase", () => ({
  isSupabaseConfigured: true,
  supabase: null,
  supabaseAdmin: {
    from: (table: string) => ({
      upsert: async (row: Record<string, unknown>, opts: unknown) => {
        if (table === "cron_heartbeat") state.upserts.push({ row, opts });
        return { error: state.error };
      },
    }),
  },
}));

import { recordHeartbeat } from "@/lib/superadmin/heartbeat";

beforeEach(() => {
  state.upserts = [];
  state.error = null;
});

describe("recordHeartbeat", () => {
  it("upserts one row per job (the job is the key)", async () => {
    await recordHeartbeat("sms-outbox", true, "sent=1");
    expect(state.upserts).toHaveLength(1);
    expect(state.upserts[0].opts).toEqual({ onConflict: "job" });
    expect(state.upserts[0].row).toMatchObject({ job: "sms-outbox", ok: true, detail: "sent=1" });
    expect(new Date(state.upserts[0].row.last_run_at as string).getTime()).toBeGreaterThan(Date.now() - 5000);
  });

  it("when the table is missing it logs the error NAME only and carries on (no throw)", async () => {
    state.error = { code: "42P01", message: 'relation "public.cron_heartbeat" does not exist' };
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(recordHeartbeat("sms-outbox", true)).resolves.toBeUndefined();
    const logged = spy.mock.calls.map((c) => c.join(" ")).join("\n");
    spy.mockRestore();
    expect(logged).toContain("cron heartbeat not written");
    expect(logged).not.toContain("cron_heartbeat does not exist");
  });

  it("a long detail is cut", async () => {
    await recordHeartbeat("sms-outbox", false, "x".repeat(500));
    expect((state.upserts[0].row.detail as string).length).toBe(200);
  });
});
