import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The SMS tables in the real database layer, against a scripted fake Supabase client:
 * the fallback for columns that do not exist yet (migration not run) and the usage count.
 */

interface Call {
  table: string;
  op: "insert" | "update" | "select";
  payload?: Record<string, unknown>;
  filters: [string, string, unknown][];
  range?: [number, number];
}

type Reply = { data?: unknown; error?: { code?: string; message?: string } | null };

const state = vi.hoisted(() => ({ calls: [] as Call[], replies: [] as Reply[] }));

vi.mock("@/lib/db/supabase", () => {
  const next = (): Reply => state.replies.shift() ?? { data: null, error: null };
  const builder = (call: Call) => {
    const b: Record<string, unknown> = {};
    for (const m of ["eq", "gte", "lte", "is", "not", "in", "order", "limit"]) {
      b[m] = (...args: unknown[]) => {
        if (m === "eq" || m === "gte" || m === "lte" || m === "is") call.filters.push([m, String(args[0]), args[1]]);
        return b;
      };
    }
    b.range = (from: number, to: number) => {
      call.range = [from, to];
      return b;
    };
    b.select = () => b;
    b.maybeSingle = async () => ({ error: null, ...next() });
    b.then = (resolve: (v: Reply) => unknown) => resolve({ error: null, ...next() });
    return b;
  };
  const admin = {
    from: (table: string) => ({
      insert: (payload: Record<string, unknown>) => {
        const call: Call = { table, op: "insert", payload, filters: [] };
        state.calls.push(call);
        return builder(call);
      },
      update: (payload: Record<string, unknown>) => {
        const call: Call = { table, op: "update", payload, filters: [] };
        state.calls.push(call);
        return builder(call);
      },
      select: () => {
        const call: Call = { table, op: "select", filters: [] };
        state.calls.push(call);
        return builder(call);
      },
    }),
  };
  return { supabaseAdmin: admin, isSupabaseConfigured: true, supabase: null };
});

import { finishSmsOutbox, getSmsUsage, insertSmsOutbox, isMissingColumnError } from "@/lib/db/sms";
import { israelMonthStartIso } from "@/lib/sms/usage";

beforeEach(() => {
  state.calls = [];
  state.replies = [];
});

const row = { appointmentId: "a1", businessId: "b1", kind: "booked" as const, toPhone: "501234567", status: "pending" as const };

describe("missing columns (migration not run yet)", () => {
  it.each([
    ["PGRST204", "Could not find the 'business_id' column of 'sms_outbox' in the schema cache"],
    ["42703", 'column "business_id" of relation "sms_outbox" does not exist'],
  ])("the insert is repeated without business_id on %s", async (code, message) => {
    state.replies = [{ error: { code, message } }, { data: { id: "row-1" } }];
    await expect(insertSmsOutbox(row)).resolves.toEqual({ id: "row-1" });
    expect(state.calls).toHaveLength(2);
    expect(state.calls[0].payload).toMatchObject({ business_id: "b1", appointment_id: "a1" });
    expect(state.calls[1].payload).not.toHaveProperty("business_id");
    expect(state.calls[1].payload).toMatchObject({ appointment_id: "a1", status: "pending" });
  });

  it("the insert goes through with the column in one call once the migration has run", async () => {
    state.replies = [{ data: { id: "row-2" } }];
    await expect(insertSmsOutbox(row)).resolves.toEqual({ id: "row-2" });
    expect(state.calls).toHaveLength(1);
    expect(state.calls[0].payload).toMatchObject({ business_id: "b1" });
  });

  it("another database error is not swallowed, and a duplicate is still just null", async () => {
    state.replies = [{ error: { code: "08006", message: "connection failure" } }];
    await expect(insertSmsOutbox(row)).rejects.toMatchObject({ code: "08006" });
    expect(state.calls).toHaveLength(1);

    state.calls = [];
    state.replies = [{ error: { code: "23505" } }];
    await expect(insertSmsOutbox(row)).resolves.toBeNull();
    expect(state.calls).toHaveLength(1);
  });

  it.each(["PGRST204", "42703"])("the finish update is repeated without segments on %s", async (code) => {
    state.replies = [{ error: { code } }, { error: null }];
    await finishSmsOutbox("row-1", { status: "sent", shipmentId: "S", segments: 2 });
    expect(state.calls).toHaveLength(2);
    expect(state.calls[0].payload).toMatchObject({ status: "sent", provider_shipment_id: "S", segments: 2 });
    expect(state.calls[1].payload).toMatchObject({ status: "sent", provider_shipment_id: "S" });
    expect(state.calls[1].payload).not.toHaveProperty("segments");
  });

  it("a finish without segments is a single update", async () => {
    await finishSmsOutbox("row-1", { status: "failed" });
    expect(state.calls).toHaveLength(1);
  });

  it("recognises both error codes and nothing else", () => {
    expect(isMissingColumnError({ code: "PGRST204" })).toBe(true);
    expect(isMissingColumnError({ code: "42703" })).toBe(true);
    expect(isMissingColumnError({ code: "23505" })).toBe(false);
    expect(isMissingColumnError(null)).toBe(false);
  });
});

describe("usage", () => {
  it("counts this business's sent rows since the start of the Israeli month and adds up the segments", async () => {
    const now = new Date("2026-10-15T12:00:00Z");
    state.replies = [{ data: [{ segments: 2 }, { segments: 3 }, { segments: null }] }];
    const usage = await getSmsUsage("b1", now);
    expect(usage).toEqual({ sent: 3, segments: 5, since: "2026-09-30T21:00:00.000Z" });

    const q = state.calls[0];
    expect(q.table).toBe("sms_outbox");
    expect(q.filters).toContainEqual(["eq", "business_id", "b1"]);
    expect(q.filters).toContainEqual(["eq", "status", "sent"]); // skipped and failed rows are not counted
    expect(q.filters).toContainEqual(["gte", "created_at", "2026-09-30T21:00:00.000Z"]);
  });

  it("reads every page", async () => {
    const page = Array.from({ length: 1000 }, () => ({ segments: 1 }));
    state.replies = [{ data: page }, { data: [{ segments: 2 }] }];
    const usage = await getSmsUsage("b1", new Date("2026-10-15T12:00:00Z"));
    expect(usage).toMatchObject({ sent: 1001, segments: 1002 });
    expect(state.calls.map((c) => c.range)).toEqual([
      [0, 999],
      [1000, 1999],
    ]);
  });

  it("fails (the screen then shows a dash) when the column does not exist yet", async () => {
    state.replies = [{ error: { code: "42703", message: "column business_id does not exist" } }];
    await expect(getSmsUsage("b1")).rejects.toMatchObject({ code: "42703" });
  });
});

describe("start of the month in Israel time", () => {
  it("summer (UTC+3) and winter (UTC+2)", () => {
    expect(israelMonthStartIso(new Date("2026-07-20T10:00:00Z"))).toBe("2026-06-30T21:00:00.000Z");
    expect(israelMonthStartIso(new Date("2026-12-20T10:00:00Z"))).toBe("2026-11-30T22:00:00.000Z");
  });

  it("uses the Israeli date, not the UTC one, around midnight", () => {
    // 2026-10-31 22:30 UTC is already 1 November in Israel (clocks went back on 25 October: UTC+2)
    expect(israelMonthStartIso(new Date("2026-10-31T22:30:00Z"))).toBe("2026-10-31T22:00:00.000Z");
    // 2026-10-31 21:30 UTC is still 31 October at 23:30
    expect(israelMonthStartIso(new Date("2026-10-31T21:30:00Z"))).toBe("2026-09-30T21:00:00.000Z");
  });
});
