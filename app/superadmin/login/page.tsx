import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { LoginClient } from "@/components/superadmin/LoginClient";
import { Logo } from "@/components/brand/Logo";
import { verifySuperadminToken } from "@/lib/superadmin/auth";
import { SUPERADMIN_COOKIE } from "@/lib/superadmin/config";

export const dynamic = "force-dynamic";

export default async function SuperadminLoginPage() {
  // already signed in: straight to the dashboard
  const store = await cookies();
  if (verifySuperadminToken(store.get(SUPERADMIN_COOKIE)?.value)) redirect("/superadmin");

  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center px-5 py-12">
      <Logo />
      <h1 className="mt-8 text-[28px] font-extrabold leading-tight">כניסה לניהול</h1>
      <p className="mt-2 text-[15px] leading-relaxed text-ink-700">הגישה למורשים בלבד.</p>
      <div className="mt-8">
        <LoginClient />
      </div>
    </main>
  );
}
