import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { supabase } from "../lib/supabase";

export function AdminGate({ children }: { children: ReactNode }) {
  const [loading, setLoading] = useState(true);
  const [admin, setAdmin] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    if (!supabase) { setLoading(false); return; }
    void supabase.auth.getSession().then(async ({ data }) => {
      if (data.session) {
        const result = await supabase.rpc("is_admin");
        setAdmin(result.data === true);
      }
      setLoading(false);
    });
  }, []);

  async function submit() {
    if (!supabase) return;
    setError("");
    const login = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    if (login.error) {
      const created = await supabase.auth.signUp({ email: email.trim(), password });
      if (created.error) { setError(login.error.message); return; }
      if (!created.data.session) {
        setError("Administrator account created. Confirm the email, then sign in with these same credentials.");
        return;
      }
      const claim = await supabase.rpc("bootstrap_first_admin");
      if (claim.error || claim.data !== true) {
        await supabase.auth.signOut();
        setError(claim.error?.message ?? "Could not initialize the first administrator.");
        return;
      }
      setAdmin(true);
      setPassword("");
      return;
    }
    const result = await supabase.rpc("is_admin");
    if (result.data !== true) {
      await supabase.auth.signOut();
      setError("This account is not the portal administrator.");
      return;
    }
    setAdmin(true);
    setPassword("");
  }

  async function signOut() {
    if (!supabase) return;
    await supabase.auth.signOut();
    setAdmin(false);
    setPassword("");
  }

  if (loading) return <div className="grid min-h-screen place-items-center bg-[#07090d] text-zinc-100 text-sm">Checking administrator access…</div>;
  if (admin) return <><>{children}</><button type="button" onClick={() => void signOut()} className="fixed bottom-5 right-5 z-[60] rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2 text-xs text-zinc-300">Sign out</button></>;
  return <main className="grid min-h-screen place-items-center bg-[#07090d] px-4 text-zinc-100"><div className="w-full max-w-md rounded-3xl border border-zinc-800 bg-zinc-900/80 p-7"><p className="text-xl font-semibold">INEC Intelligence</p><p className="mt-2 text-xs text-zinc-500">Use the administrator credentials to enter the portal.</p><input className="mt-6 w-full rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-3 text-sm" type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="Email" /><input className="mt-3 w-full rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-3 text-sm" type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="Password" /><button type="button" onClick={() => void submit()} className="mt-4 w-full rounded-xl bg-zinc-100 px-4 py-3 text-sm font-semibold text-zinc-950">Continue</button>{error && <p className="mt-3 text-xs text-red-300">{error}</p>}</div></main>;
}