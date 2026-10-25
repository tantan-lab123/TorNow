import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * Static checks on supabase/migrations/20261026000002_sms_billed_messages.sql (it is not run here): it adds one
 * column, fills it once for old sent rows, and recreates the two dashboard functions with a "billed" column.
 */

const strip = (sql: string) =>
  sql
    .split("\n")
    .filter((l) => !l.trim().startsWith("--"))
    .join("\n");

const sql = readFileSync("supabase/migrations/20261026000002_sms_billed_messages.sql", "utf8");
const code = strip(sql);
const previous = strip(readFileSync("supabase/migrations/20261026000001_superadmin_metrics.sql", "utf8"));

/** The column names a function returns, in order. */
const returnedColumns = (text: string, fn: string): string[] => {
  const start = text.indexOf(`function public.${fn}(`);
  const returns = text.indexOf("returns table (", start);
  const end = text.indexOf(")\nlanguage", returns);
  return text
    .slice(returns + "returns table (".length, end)
    .split(",")
    .map((c) => c.trim().split(/\s+/)[0])
    .filter(Boolean);
};

describe("the billed_messages migration", () => {
  it("adds one nullable integer column, safely", () => {
    expect(code).toMatch(/alter table public\.sms_outbox add column if not exists billed_messages integer;/);
    expect(code).not.toMatch(/billed_messages\s+integer\s+not null/i);
    expect(code).not.toMatch(/\bdefault\b/i);
  });

  it("the one-time fill touches only sent rows that have no number, and sets nothing else", () => {
    const updates = [...code.matchAll(/\bupdate\b[^;]*;/gi)].map((m) => m[0]);
    expect(updates).toHaveLength(1);
    const update = updates[0].replace(/\s+/g, " ");
    expect(update).toContain("update public.sms_outbox set billed_messages = ceil(coalesce(segments, 1) / 3.0)::int");
    expect(update).toMatch(/where status = 'sent' and billed_messages is null;$/);
    // only that column is assigned
    const assigned = update.slice(update.indexOf(" set ") + 5, update.indexOf(" where "));
    expect(assigned.startsWith("billed_messages = ")).toBe(true);
    expect((assigned.match(/=/g) ?? []).length).toBe(1);
  });

  it("is safe to run twice (the fill only matches nulls; the functions are dropped if present first)", () => {
    expect(code).toMatch(/add column if not exists/);
    const drops = [...code.matchAll(/drop function if exists public\.(\w+)\(/g)].map((m) => m[1]);
    expect(drops).toEqual(["admin_business_rollup", "admin_sms_series"]);
    expect(code).not.toMatch(/drop function(?! if exists)/i);
    expect(code).not.toMatch(/\b(delete|truncate)\b/i);
    expect(code).not.toMatch(/drop (table|column|index)/i);
  });

  it("creates no new SQL function for the billing rule: only the two dashboard functions come back", () => {
    const created = [...code.matchAll(/create (?:or replace )?function public\.(\w+)/gi)].map((m) => m[1]);
    expect(created).toEqual(["admin_business_rollup", "admin_sms_series"]);
    // the rule (ceil(chars / 201)) lives in the application only
    expect(code).not.toMatch(/\b201\b/);
    expect(code).not.toMatch(/length\s*\(/i);
  });

  it("keeps every old column, in order, and adds billed", () => {
    const oldSeries = returnedColumns(previous, "admin_sms_series");
    const newSeries = returnedColumns(code, "admin_sms_series");
    expect(newSeries.filter((c) => c !== "billed")).toEqual(oldSeries);
    expect(newSeries).toContain("billed");

    const oldRollup = returnedColumns(previous, "admin_business_rollup");
    const newRollup = returnedColumns(code, "admin_business_rollup");
    expect(newRollup.filter((c) => c !== "sms_billed_30d")).toEqual(oldRollup);
    expect(newRollup).toContain("sms_billed_30d");
  });

  it("billed is the sum of billed_messages over SENT rows; a sent row without a number counts 1", () => {
    const sums = code.match(/coalesce\(sum\(coalesce\(o\.billed_messages, 1\)\) filter \(where o\.status = 'sent'\), 0\)::int/g) ?? [];
    expect(sums).toHaveLength(2); // the rollup and the series
  });

  it("keeps the demo exclusion, the Israel days, the search_path and stable / read-only", () => {
    expect(code).toContain("coalesce(b.slug = any (p_demo_slugs), false) or coalesce(b.id = any (p_demo_ids), false)");
    expect(code).toContain("at time zone 'Asia/Jerusalem'");
    expect((code.match(/set search_path = public, pg_temp/g) ?? []).length).toBe(2);
    expect((code.match(/\bstable\b/g) ?? []).length).toBe(2);
    const functions = code.slice(code.indexOf("create function"));
    expect(functions).not.toMatch(/\b(insert|update|delete)\b/i);
  });

  it("execute stays for service_role only, as before", () => {
    for (const fn of [
      ["admin_business_rollup", "timestamptz, timestamptz, timestamptz, timestamptz, timestamptz, text"],
      ["admin_sms_series", "timestamptz, text\\[\\], uuid\\[\\]"],
    ]) {
      expect(code).toMatch(new RegExp(`revoke all on function public\\.${fn[0]}\\(${fn[1]}\\)\\s+from public, anon, authenticated`));
      expect(code).toMatch(new RegExp(`grant execute on function public\\.${fn[0]}\\(${fn[1]}\\)\\s+to service_role`));
    }
    expect(code).not.toMatch(/grant[^;]*\bto\b[^;]*\b(anon|authenticated|public)\b/i);
  });

  it("the functions read counts, never a person: no customer, phone, e-mail, token or message column", () => {
    const functions = code.slice(code.indexOf("create function")).toLowerCase();
    for (const word of ["first_name", "last_name", "phone", "email", "password", "token", "\\bmessage\\b", "message_text", "clients", "select \\*"]) {
      expect(functions, word).not.toMatch(new RegExp(word, "i"));
    }
  });
});
