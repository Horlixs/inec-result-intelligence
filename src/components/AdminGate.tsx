import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";

export function AdminGate({ children }: { children: any }) {
  const [loading, setLoading] = useState(true);
  const [admin, setAdmin] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    if (!supabase) { setLoading(false); return; }
    supabase.auth.getSession().then(({ data }) => {
      if (!data.session) { setLoading(false); return; }
      supabase.rpc("is_admin").then(({ data: value }) => {
        setAdmin(value === true);
        setLoading(false);
      });
    });
  }, []);

  async function submit() {
    if (!supabase) return;
    setError("");
    const login = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    if (login.error) { setError(login.error.message); return; }
    const result = await supabase.rpc("is_admin");
    if (result.data !== true) {
      await supabase.auth.signOut();
      setError("This account is not the portal administrator.");
      return;
    }
    setAdmin(true);
    setPassword("");
  }

  if (loading) return <div className="grid min-h-screen place-items-center bg-[#07090d] text-zinc-100 text-sm">Checking administrator access…</div>;
  if (admin) return <>{children}</>;
  return <main className="grid min-h-screen place-items-center bg-[#07090d] px-4 text-zinc-100"><div className="w-full max-w-md rounded-3xl border border-zinc-800 bg-zinc-900/80 p-7"><p className="text-xl font-semibold">INEC Intelligence</p><p className="mt-2 text-xs text-zinc-500">Administrator sign-in required.</p><input className="mt-6 w-full rounded-xl border border-zinc-800 bg-zinc-950 p-3" type="email" value={email} onChange={e=>setEmail(e.target.value)} /><input className="mt-3 w-full rounded-xl border border-zinc-800 bg-zinc-950 p-3" type="password" value={password} onChange={e=>setPassword(e.target.value)} /><button type="button" onClick={()=>void submit()} className="mt-4 w-full rounded-xl bg-zinc-100 p-3 text-sm font-semibold text-zinc-950">Sign in</button>{error && <p className="mt-3 text-xs text-red-300">{error}</p>}</div></main>;
}
