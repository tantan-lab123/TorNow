"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { KeyRound, CheckCircle2, AlertCircle } from "lucide-react";
import { supabase } from "@/lib/db/supabase";
import { validatePassword } from "@/lib/utils";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Card } from "@/components/ui/Card";

type Phase = "checking" | "ready" | "invalid" | "done";

/** Landing page of the emailed recovery link: proves the mailbox, then sets a new password. */
export default function ResetPasswordPage() {
  // without the auth client there is nothing to check: the link can not work
  const [phase, setPhase] = useState<Phase>(supabase ? "checking" : "invalid");
  const [token, setToken] = useState("");
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!supabase) return;
    let settled = false;
    const accept = (session: { access_token: string } | null) => {
      if (settled || !session) return;
      settled = true;
      setToken(session.access_token);
      setPhase("ready");
    };
    // the client library turns the #access_token in the link into a session
    supabase.auth.getSession().then(({ data }) => accept(data.session));
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => accept(session));
    const timer = setTimeout(() => {
      if (!settled) setPhase("invalid");
    }, 4000);
    return () => {
      clearTimeout(timer);
      sub.subscription.unsubscribe();
    };
  }, []);

  const check = validatePassword(password);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    if (!check.isValid) {
      setError("הסיסמה אינה עומדת בכל כללי האבטחה");
      return;
    }
    if (password !== confirm) {
      setError("הסיסמאות אינן זהות");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/auth/reset", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ access_token: token, phone, new_password: password }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || "שגיאה באיפוס הסיסמה");
        return;
      }
      await supabase?.auth.signOut();
      setPhase("done");
    } catch {
      setError("שגיאת תקשורת");
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="min-h-screen bg-slate-50 flex items-center justify-center p-4" dir="rtl">
      <Card className="w-full max-w-md p-6 bg-white border border-slate-200 shadow-md text-right space-y-4">
        <div className="text-center space-y-1">
          <div className="w-12 h-12 rounded-2xl bg-indigo-600 text-white flex items-center justify-center mx-auto">
            <KeyRound className="w-6 h-6" />
          </div>
          <h1 className="text-xl font-extrabold text-slate-900">איפוס סיסמה</h1>
        </div>

        {phase === "checking" && <p className="text-center text-sm text-slate-500">בודק את הקישור...</p>}

        {phase === "invalid" && (
          <div className="space-y-3 text-center">
            <AlertCircle className="w-8 h-8 text-amber-500 mx-auto" />
            <p className="text-sm text-slate-700">הקישור אינו תקף או שפג תוקפו. בקש קישור חדש מדף הכניסה.</p>
            <Link href="/admin" className="inline-block text-sm font-bold text-indigo-600 underline">
              חזרה לדף הכניסה
            </Link>
          </div>
        )}

        {phase === "ready" && (
          <form onSubmit={submit} className="space-y-3.5">
            <p className="text-xs text-slate-600">
              האימייל אומת. לאבטחה, הזן גם את מספר הטלפון של החשבון ובחר סיסמה חדשה.
            </p>
            <Input
              label="מספר טלפון של החשבון *"
              type="tel"
              dir="ltr"
              placeholder="054-1234567"
              className="text-right"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              required
            />
            <Input
              label="סיסמה חדשה *"
              type="password"
              dir="ltr"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              helperText="לפחות 8 תווים, אות גדולה, אות קטנה, ספרה ותו מיוחד"
              required
            />
            <Input
              label="אימות סיסמה *"
              type="password"
              dir="ltr"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              required
            />
            {error && <div className="rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-sm p-2.5">{error}</div>}
            <Button type="submit" className="w-full" disabled={busy}>
              {busy ? "שומר..." : "שמור סיסמה חדשה"}
            </Button>
          </form>
        )}

        {phase === "done" && (
          <div className="space-y-3 text-center">
            <CheckCircle2 className="w-10 h-10 text-emerald-600 mx-auto" />
            <p className="text-sm font-bold text-slate-800">הסיסמה עודכנה בהצלחה.</p>
            <Link
              href="/admin"
              className="inline-block rounded-2xl bg-indigo-600 text-white text-sm font-bold px-5 py-2.5 hover:bg-indigo-700"
            >
              כניסה למערכת
            </Link>
          </div>
        )}
      </Card>
    </main>
  );
}
