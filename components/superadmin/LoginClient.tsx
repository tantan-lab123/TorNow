"use client";

import React, { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/db/supabase";

type State = "idle" | "checking" | "refused" | "unavailable";

/**
 * Sign-in to the operator dashboard.
 *
 * Google (through Supabase Auth, no extra scopes) proves who is at the keyboard. The access token goes to
 * our server ONCE; the server decides, and on success sets its own cookie. Whatever the answer, the
 * Supabase session is then removed from this browser: nothing of Google's stays in localStorage, where
 * the booking page and the calendar-connect flow would also find it.
 */
export function LoginClient() {
  const router = useRouter();
  const [state, setState] = useState<State>("idle");
  const ran = useRef(false);

  useEffect(() => {
    if (ran.current || !supabase) return;
    ran.current = true;
    const run = async () => {
      // back from Google: the session is in the browser now
      const { data } = await supabase!.auth.getSession();
      const token = data.session?.access_token;
      if (!token) return;
      setState("checking");
      let ok = false;
      try {
        const res = await fetch("/api/superadmin/session", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ access_token: token }),
          cache: "no-store",
        });
        ok = res.ok;
      } catch {
        ok = false;
      }
      // in every case: no Google session is left behind in this browser
      try {
        await supabase!.auth.signOut({ scope: "local" });
      } catch {
        // nothing more to do
      }
      if (ok) router.replace("/superadmin");
      else setState("refused");
    };
    void run();
  }, [router]);

  const signIn = async () => {
    if (!supabase) {
      setState("unavailable");
      return;
    }
    setState("checking");
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      // no scopes beyond the default sign-in: no calendar, nothing else
      options: { redirectTo: `${window.location.origin}/superadmin/login` },
    });
    if (error) setState("unavailable");
  };

  return (
    <div className="space-y-4">
      <button
        type="button"
        onClick={signIn}
        disabled={state === "checking"}
        className="m-key2 inline-flex h-12 w-full items-center justify-center gap-2 rounded-lg border border-ink-200 bg-white px-6 text-[16px] font-bold text-ink-900 disabled:opacity-60"
      >
        {state === "checking" ? "בודקים..." : "התחברות עם Google"}
      </button>
      <div aria-live="polite" className="min-h-6 text-center text-sm font-semibold text-danger-700">
        {state === "refused" && "לא ניתן להתחבר."}
        {state === "unavailable" && "ההתחברות אינה זמינה כרגע."}
      </div>
    </div>
  );
}
