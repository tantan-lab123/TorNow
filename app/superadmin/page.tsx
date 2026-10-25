import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { Dashboard } from "@/components/superadmin/Dashboard";
import { LogoutButton, RefreshButton } from "@/components/superadmin/Controls";
import { verifySuperadminToken } from "@/lib/superadmin/auth";
import { SUPERADMIN_COOKIE } from "@/lib/superadmin/config";
import { getMetrics } from "@/lib/superadmin/get-metrics";
import type { Metrics } from "@/lib/superadmin/metrics";

export const dynamic = "force-dynamic";

export default async function SuperadminPage() {
  // The cookie is checked here, on the server, on every request (and the e-mail against the allowlist as it is right now).
  const store = await cookies();
  if (!verifySuperadminToken(store.get(SUPERADMIN_COOKIE)?.value)) redirect("/superadmin/login");

  let metrics: Metrics | null = null;
  try {
    metrics = await getMetrics();
  } catch (err) {
    console.error("superadmin metrics failed:", err instanceof Error ? err.name : "unknown");
  }

  if (!metrics) {
    return (
      <main className="mx-auto max-w-xl px-5 py-16">
        <h1 className="text-[28px] font-extrabold">לוח בקרה</h1>
        <p role="alert" className="mt-4 text-[16px] leading-relaxed text-ink-800">
          אי אפשר לטעון את הנתונים כרגע. ייתכן שהמיגרציה של לוח הבקרה עדיין לא הורצה.
        </p>
        <div className="mt-6 flex gap-2">
          <RefreshButton />
          <LogoutButton />
        </div>
      </main>
    );
  }
  return <Dashboard metrics={metrics} />;
}
