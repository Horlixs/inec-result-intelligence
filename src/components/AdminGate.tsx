import { useState } from "react";
import { portalAuthenticate } from "../lib/supabase";

export function AdminGate({ children }: { children: any }) {
  const [admin, setAdmin] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");

  async function submit() {
    setError("");
    const result = await portalAuthenticate(email, password);
    if (!result.ok) { setError(result.error ?? "Authentication failed."); return; }
    setAdmin(true);
    setPassword("");
  }

  if (admin) return <>{children}</>;
  return <main className="grid min-h-screen place-items-center bg-[#07090d] px-4 text-zinc-100"><div className="w-full max-w-md rounded-3xl border border-zinc-800 bg-zinc-900/80 p-7"><p className="text-xl font-semibold">INEC Intelligence</p><p className="mt-2 text-xs text-zinc-500">Administrator sign-in required.</p><input className="mt-6 w-full rounded-xl border border-zinc-800 bg-zinc-950 p-3" type="email" value={email} onChange={e=>setEmail(e.target.value)} placeholder="Email" /><input className="mt-3 w-full rounded-xl border border-zinc-800 bg-zinc-950 p-3" type="password" value={password} onChange={e=>setPassword(e.target.value)} placeholder="Password" /><button type="button" onClick={()=>void submit()} className="mt-4 w-full rounded-xl bg-zinc-100 p-3 text-sm font-semibold text-zinc-950">Continue</button>{error && <p className="mt-3 text-xs text-red-300">{error}</p>}</div></main>;
}
