import { readFileSync, readdirSync, statSync } from "node:fs";
import { describe, expect, it } from "vitest";
import robots from "@/app/robots";
import sitemap from "@/app/sitemap";
import { metadata as layoutMetadata } from "@/app/superadmin/layout";

const files = (dir: string): string[] =>
  readdirSync(dir).flatMap((name) => {
    const path = `${dir}/${name}`;
    return statSync(path).isDirectory() ? files(path) : /\.(ts|tsx)$/.test(path) ? [path] : [];
  });

const SUPERADMIN_DIRS = ["lib/superadmin", "app/superadmin", "app/api/superadmin", "components/superadmin"];

describe("headers", () => {
  it("noindex and no-store on every /superadmin page and every /api/superadmin route", async () => {
    const config = (await import("../../next.config.mjs")).default as { headers: () => Promise<{ source: string; headers: { key: string; value: string }[] }[]> };
    const rules = await config.headers();
    for (const source of ["/superadmin", "/superadmin/:path*", "/api/superadmin/:path*"]) {
      const rule = rules.find((r) => r.source === source);
      expect(rule, source).toBeDefined();
      const h = Object.fromEntries(rule!.headers.map((x) => [x.key, x.value]));
      expect(h["X-Robots-Tag"]).toMatch(/noindex/);
      expect(h["Cache-Control"]).toBe("no-store");
      expect(h["Referrer-Policy"]).toBe("no-referrer");
    }
  });

  it("the layout says noindex in the page itself too", () => {
    expect(layoutMetadata.robots).toMatchObject({ index: false, follow: false });
  });

  it("the API routes answer no-store by themselves as well", () => {
    for (const f of ["metrics", "logout", "session"]) {
      expect(readFileSync(`app/api/superadmin/${f}/route.ts`, "utf8")).toMatch(/no-store|JSON_NO_STORE/);
    }
  });
});

describe("robots and sitemap", () => {
  it("/superadmin is disallowed in robots", () => {
    const rules = robots().rules as { disallow?: string[] };
    expect(rules.disallow).toContain("/superadmin");
    expect(rules.disallow).toContain("/api/"); // which already covers /api/superadmin
  });

  it("/superadmin is not in the sitemap", () => {
    for (const entry of sitemap()) expect(entry.url).not.toMatch(/superadmin/i);
  });
});

describe("not public", () => {
  it("nothing outside the dashboard links to it", () => {
    const outside = ["app", "components", "lib"]
      .flatMap((d) => files(d))
      .filter((f) => !SUPERADMIN_DIRS.some((dir) => f.startsWith(dir + "/")) && !f.includes("__tests__") && !f.startsWith("app/robots"))
      // the one place outside that mentions it: the cron job notes its heartbeat
      .filter((f) => f !== "app/api/cron/sms-outbox/route.ts");
    for (const f of outside) {
      expect(readFileSync(f, "utf8").toLowerCase(), f).not.toContain("superadmin");
    }
  });

  it("the dashboard makes no external request and has no analytics", () => {
    for (const f of SUPERADMIN_DIRS.flatMap(files)) {
      const text = readFileSync(f, "utf8");
      expect(text.match(/https?:\/\//g) ?? [], f).toEqual([]);
      expect(text.toLowerCase(), f).not.toMatch(/@sentry|sentry\.io|\banalytics\b|gtag|googletagmanager|segment\.com/);
    }
  });

  it("no chart library: the charts are SVG and tables", () => {
    const pkg = JSON.parse(readFileSync("package.json", "utf8")) as { dependencies: Record<string, string> };
    for (const lib of ["recharts", "chart.js", "d3", "victory", "nivo", "apexcharts", "echarts"]) {
      expect(Object.keys(pkg.dependencies)).not.toContain(lib);
    }
  });
});

describe("the content security policy is untouched", () => {
  const proxy = readFileSync("proxy.ts", "utf8");

  it("scripts still need the nonce; Supabase is the only extra place a page may connect to", () => {
    expect(proxy).toContain("script-src 'self' 'nonce-${nonce}' 'strict-dynamic'");
    expect(proxy).toContain('"connect-src \'self\' https://*.supabase.co wss://*.supabase.co"');
    expect(proxy).not.toMatch(/script-src[^\n]*unsafe-inline/);
  });

  it("the login page is covered by the policy (the matcher excludes only the API and static files)", () => {
    expect(proxy).toContain("/((?!api|_next/static");
    expect(proxy).not.toContain("superadmin");
  });
});

describe("the login flow", () => {
  // the code without its comments (a comment may well say "no calendar" or mention localStorage)
  const login = readFileSync("components/superadmin/LoginClient.tsx", "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");

  it("asks Google for the default sign-in only: no scopes, no calendar", () => {
    expect(login).toContain('provider: "google"');
    expect(login).not.toMatch(/scopes\s*:/);
    expect(login).not.toMatch(/calendar/i);
    expect(login).not.toContain("queryParams");
  });

  it("returns to the login page, posts the token once, and always signs out locally afterwards", () => {
    expect(login).toContain("/superadmin/login");
    expect(login).toContain("/api/superadmin/session");
    expect(login).toContain('signOut({ scope: "local" })');
    // the sign-out is not inside the success branch
    expect(login.indexOf("signOut")).toBeLessThan(login.indexOf("router.replace"));
  });

  it("never logs or stores the token", () => {
    expect(login).not.toMatch(/console\./);
    expect(login).not.toMatch(/localStorage|sessionStorage/);
  });
});

describe("the migration", () => {
  const sql = readFileSync("supabase/migrations/20261026000001_superadmin_metrics.sql", "utf8");
  const code = sql
    .split("\n")
    .filter((l) => !l.trim().startsWith("--"))
    .join("\n");
  const functions = code.slice(code.indexOf("create or replace function"));

  it("only adds: no drop, delete, truncate, update or column changes", () => {
    expect(code).not.toMatch(/\b(drop|delete|truncate|update)\b/i);
    expect(code).not.toMatch(/alter\s+table\s+public\.(?!admin_access_log|cron_heartbeat)/i);
    expect(code).not.toMatch(/alter\s+table[^;]*\b(drop|alter column|rename)\b/i);
  });

  it("is safe to run again", () => {
    for (const m of code.matchAll(/create\s+(table|index)\s+(?!if not exists)/gi)) throw new Error(`not idempotent: ${m[0]}`);
    expect(code).not.toMatch(/create\s+function/i); // only "create or replace"
  });

  it("both tables are server only: RLS on, no policy, nothing for anon / authenticated", () => {
    for (const table of ["admin_access_log", "cron_heartbeat"]) {
      expect(code).toContain(`alter table public.${table} enable row level security`);
      expect(code).toContain(`revoke all on public.${table} from anon, authenticated`);
    }
    expect(code).not.toMatch(/create\s+policy/i);
  });

  it("the access log can not hold a raw e-mail of a rejected attempt", () => {
    expect(code).toContain("check (success or email is null)");
  });

  it("three admin_ functions, all stable and read-only", () => {
    const names = [...functions.matchAll(/create or replace function public\.(\w+)/g)].map((m) => m[1]);
    expect(names).toEqual(["admin_business_rollup", "admin_sms_series", "admin_sms_health"]);
    expect((functions.match(/\bstable\b/g) ?? []).length).toBe(3);
    expect(functions).not.toMatch(/\b(insert|update|delete)\b/i);
  });

  it("execute is for service_role only: revoked from public, anon and authenticated, then granted", () => {
    for (const fn of ["admin_business_rollup", "admin_sms_series", "admin_sms_health"]) {
      expect(code).toMatch(new RegExp(`revoke all on function public\\.${fn}\\([^)]*\\)\\s+from public, anon, authenticated`));
      expect(code).toMatch(new RegExp(`grant execute on function public\\.${fn}\\([^)]*\\)\\s+to service_role`));
    }
    expect(code).not.toMatch(/grant[^;]*\bto\b[^;]*\b(anon|authenticated|public)\b/i);
  });

  it("the functions read counts, never a person: no customer, phone, e-mail, password, token or message column", () => {
    for (const word of ["first_name", "last_name", "phone", "email", "password", "owner_", "google_id", "token", "message", "clients", "select \\*"]) {
      expect(functions.toLowerCase(), word).not.toMatch(new RegExp(word, "i"));
    }
    // appointment notes are only COMPARED with the owner form's note, never selected or returned
    const noteUses = functions.match(/\bnotes\b/g) ?? [];
    expect(noteUses.length).toBe(3);
    expect(functions.match(/notes is not distinct from p_manual_note/g)?.length).toBe(3);
  });

  it("groups by Israel days", () => {
    expect(functions).toContain("at time zone 'Asia/Jerusalem'");
  });
});
