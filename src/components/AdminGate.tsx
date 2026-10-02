import { useEffect, useState } from "react";
import { portalAuthenticate, portalAuthListener, portalGetSession, portalIsAdmin, portalSignOut } from "../lib/supabase";

export function AdminGate({ children }: { children: any }) {
  const [admin, setAdmin] = useState(false);
  const [checking, setChecking] = useState(true);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    let active = true;
    void (async () => {
      const session = await portalGetSession();
      if (!active) return;
      if (session) {
        const allowed = await portalIsAdmin();
        if (!active) return;
        setAdmin(allowed);
      }
      setChecking(false);
    })();

    const subscription = portalAuthListener((_session) => {
      if (!_session) {
        setAdmin(false);
        return;
      }
      void portalIsAdmin().then(allowed => setAdmin(allowed));
    });

    return () => {
      active = false;
      subscription?.unsubscribe();
    };
  }, []);

  async function submit() {
    if (submitting) return;
    setError("");
    setSubmitting(true);
    try {
      const result = await portalAuthenticate(email, password);
      if (!result.ok) {
        setError(result.error ?? "Authentication failed.");
        return;
      }
      setAdmin(true);
      setPassword("");
    } finally {
      setSubmitting(false);
    }
  }

  if (checking) {
    return <main className="grid min-h-screen place-items-center bg-[#07090d] px-4 text-zinc-100"><p className="text-sm text-zinc-500">Checking administrator session…</p></main>;
  }

  if (admin) return <>{children}</>;

  return <main className="grid min-h-screen place-items-center bg-[#07090d] px-4 text-zinc-100"><div className="w-full max-w-md rounded-3xl border border-zinc-800 bg-zinc-900/80 p-7"><p className="text-xl font-semibold">INEC Intelligence</p><p className="mt-2 text-xs text-zinc-500">Administrator sign-in required.</p><input className="mt-6 w-full rounded-xl border border-zinc-800 bg-zinc-950 p-3" type="email" value={email} onChange={e=>setEmail(e.target.value)} placeholder="Email" /><input className="mt-3 w-full rounded-xl border border-zinc-800 bg-zinc-950 p-3" type="password" value={password} onChange={e=>setPassword(e.target.value)} placeholder="Password" /><button type="button" onClick={()=>void submit()} disabled={submitting} className="mt-4 w-full rounded-xl bg-zinc-100 p-3 text-sm font-semibold text-zinc-950 disabled:cursor-not-allowed disabled:opacity-60">{submitting ? "Signing in…" : "Continue"}</button>{error && <p className="mt-3 text-xs text-red-300">{error}</p>}{admin && <button type="button" onClick={()=>void portalSignOut()} className="mt-3 text-xs text-zinc-500">Sign out</button>}</div></main>;
}
