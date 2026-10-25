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
  columns?: string;
  selectOpts?: Record<string, unknown>;
}

type Reply = { data?: unknown; count?: number | null; error?: { code?: string; message?: string } | null };

const state = vi.hoisted(() => ({ calls: [] as Call[], replies: [] as Reply[] }));

vi.mock("@/lib/db/supabase", () => {
  const next = (): Reply => state.replies.shift() ?? { data: null, error: null };
  const builder = (call: Call) => {
    const b: Record<string, unknown> = {};
    for (const m of ["eq", "neq", "gte", "lte", "is", "not", "in", "order", "limit"]) {
      b[m] = (...args: unknown[]) => {
        if (m === "eq" || m === "neq" || m === "gte" || m === "lte" || m === "is" || m === "in") call.filters.push([m, String(args[0]), args[1]]);
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
      select: (columns?: string, selectOpts?: Record<string, unknown>) => {
        const call: Call = { table, op: "select", filters: [], columns, selectOpts };
        state.calls.push(call);
        return builder(call);
      },
    }),
  };
  return { supabaseAdmin: admin, isSupabaseConfigured: true, supabase: null };
});

import {
  countRecentByPhone,
  finishSmsOutbox,
  getReminderStart,
  getSmsUsage,
  insertSmsOutbox,
  isMissingColumnError,
} from "@/lib/db/sms";
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

  it("billed_messages is written in the same update as the segments", async () => {
    await finishSmsOutbox("row-1", { status: "sent", segments: 4, billedMessages: 2 });
    expect(state.calls).toHaveLength(1);
    expect(state.calls[0].payload).toMatchObject({ status: "sent", segments: 4, billed_messages: 2 });
  });

  it("billed_messages column missing: repeated without it, the segments are kept", async () => {
    state.replies = [{ error: { code: "PGRST204" } }, { error: null }];
    await finishSmsOutbox("row-1", { status: "sent", segments: 4, billedMessages: 2 });
    expect(state.calls).toHaveLength(2);
    expect(state.calls[1].payload).toMatchObject({ status: "sent", segments: 4 });
    expect(state.calls[1].payload).not.toHaveProperty("billed_messages");
  });

  it("neither new column exists: three tries, the last one is the plain status update, and it never throws for them", async () => {
    state.replies = [{ error: { code: "42703" } }, { error: { code: "42703" } }, { error: null }];
    await finishSmsOutbox("row-1", { status: "sent", segments: 4, billedMessages: 2 });
    expect(state.calls).toHaveLength(3);
    expect(state.calls[2].payload).not.toHaveProperty("segments");
    expect(state.calls[2].payload).not.toHaveProperty("billed_messages");
    expect(state.calls[2].payload).toMatchObject({ status: "sent" });
  });

  it("another error on the first try is thrown, not retried", async () => {
    state.replies = [{ error: { code: "08006" } }];
    await expect(finishSmsOutbox("row-1", { status: "sent", segments: 4, billedMessages: 2 })).rejects.toMatchObject({ code: "08006" });
    expect(state.calls).toHaveLength(1);
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
    state.replies = [
      {
        data: [
          { billed_messages: 2, segments: 2 },
          { billed_messages: 1, segments: 3 },
          { billed_messages: null, segments: null }, // sent before the column existed: counts 1
        ],
      },
    ];
    const usage = await getSmsUsage("b1", now);
    expect(usage).toEqual({
      sent: 3,
      billed: 4,
      segments: 5,
      byKind: { booked: 3, reminder: 0 },
      since: "2026-09-30T21:00:00.000Z",
    });

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
    state.replies = [
      { error: { code: "42703", message: "column business_id does not exist" } },
      { error: { code: "42703", message: "column business_id does not exist" } },
    ];
    await expect(getSmsUsage("b1")).rejects.toMatchObject({ code: "42703" });
  });

  it("billed_messages not there yet: read again without it, every sent row counts 1", async () => {
    state.replies = [{ error: { code: "42703" } }, { data: [{ segments: 4, kind: "booked" }, { segments: 9, kind: "reminder" }] }];
    const usage = await getSmsUsage("b1", new Date("2026-10-15T12:00:00Z"));
    expect(usage).toMatchObject({ sent: 2, billed: 2, segments: 13 });
    expect(state.calls.map((c) => c.columns)).toEqual(["billed_messages, segments, kind", "segments, kind"]);
  });

  it("a long message counts as several: the owner's number is the sum of billed_messages", async () => {
    state.replies = [{ data: [{ billed_messages: 3, segments: 9, kind: "booked" }, { billed_messages: 1, segments: 2, kind: "booked" }] }];
    const usage = await getSmsUsage("b1", new Date("2026-10-15T12:00:00Z"));
    expect(usage).toMatchObject({ sent: 2, billed: 4 });
  });
});

describe("usage by kind", () => {
  it("counts confirmations and reminders separately (both are in the total)", async () => {
    state.replies = [
      {
        data: [
          { billed_messages: 1, segments: 2, kind: "booked" },
          { billed_messages: 1, segments: 2, kind: "reminder" },
          { billed_messages: 1, segments: 2, kind: "reminder" },
        ],
      },
    ];
    const usage = await getSmsUsage("b1", new Date("2026-10-15T12:00:00Z"));
    expect(usage).toMatchObject({ sent: 3, billed: 3, segments: 6, byKind: { booked: 1, reminder: 2 } });
    expect(state.calls[0].columns).toBe("billed_messages, segments, kind");
  });
});

describe("reminder rows", () => {
  const reminder = {
    appointmentId: "a1",
    businessId: "b1",
    kind: "reminder" as const,
    forStartTime: "2026-11-05T13:30:00Z",
    toPhone: "501234567",
    status: "pending" as const,
  };

  it("are written with the appointment time they are for", async () => {
    state.replies = [{ data: { id: "r1" } }];
    await expect(insertSmsOutbox(reminder)).resolves.toEqual({ id: "r1" });
    expect(state.calls[0].payload).toMatchObject({ kind: "reminder", for_start_time: "2026-11-05T13:30:00Z" });
  });

  it("confirmations are written without it (they keep working before the migration)", async () => {
    state.replies = [{ data: { id: "c1" } }];
    await insertSmsOutbox({ ...reminder, kind: "booked", forStartTime: null });
    expect(state.calls[0].payload).not.toHaveProperty("for_start_time");
  });

  it("a reminder is NOT written without its time when the column is missing: it fails, nothing is sent", async () => {
    state.replies = [{ error: { code: "PGRST204", message: "Could not find the 'for_start_time' column" } }];
    await expect(insertSmsOutbox(reminder)).rejects.toMatchObject({ code: "PGRST204" });
    expect(state.calls).toHaveLength(1);
  });

  it("a second reminder for the same appointment time is the duplicate (null), not an error", async () => {
    state.replies = [{ error: { code: "23505" } }];
    await expect(insertSmsOutbox(reminder)).resolves.toBeNull();
  });

  it("the start time of a row is read back", async () => {
    state.replies = [{ data: { for_start_time: "2026-11-05T13:30:00+00:00" } }];
    await expect(getReminderStart("r1")).resolves.toBe("2026-11-05T13:30:00+00:00");
    state.replies = [{ data: null }];
    await expect(getReminderStart("nope")).resolves.toBeNull();
  });
});

describe("the per-phone count", () => {
  it("counts only pending and sent rows of that phone since the given time", async () => {
    state.replies = [{ count: 2 }];
    await expect(countRecentByPhone("501234567", "2026-11-05T09:00:00.000Z")).resolves.toBe(2);
    const q = state.calls[0];
    expect(q.table).toBe("sms_outbox");
    expect(q.selectOpts).toMatchObject({ count: "exact", head: true });
    expect(q.filters).toContainEqual(["eq", "to_phone", "501234567"]);
    expect(q.filters).toContainEqual(["in", "status", ["pending", "sent"]]);
    expect(q.filters).toContainEqual(["gte", "created_at", "2026-11-05T09:00:00.000Z"]);
  });

  it("can leave out one row and only look at the rows created before it", async () => {
    state.replies = [{ count: 0 }];
    await countRecentByPhone("501234567", "2026-11-05T09:00:00.000Z", {
      excludeId: "row-9",
      createdUpToIso: "2026-11-05T09:30:00.000Z",
    });
    const q = state.calls[0];
    expect(q.filters).toContainEqual(["neq", "id", "row-9"]);
    expect(q.filters).toContainEqual(["lte", "created_at", "2026-11-05T09:30:00.000Z"]);
  });

  it("a database error is not swallowed (the caller decides)", async () => {
    state.replies = [{ error: { code: "08006", message: "connection failure" } }];
    await expect(countRecentByPhone("501234567", "2026-11-05T09:00:00.000Z")).rejects.toMatchObject({ code: "08006" });
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
