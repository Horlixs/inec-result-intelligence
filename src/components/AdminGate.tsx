import { useState } from "react";

export function AdminGate({ children }: { children: any }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [ok, setOk] = useState(false);
  if (ok) return children;
  return <main className="grid min-h-screen place-items-center bg-[#07090d] px-4 text-zinc-100"><div className="w-full max-w-md rounded-3xl border border-zinc-800 bg-zinc-900/80 p-7"><p className="text-xl font-semibold">INEC Intelligence</p><input className="mt-6 w-full rounded-xl border border-zinc-800 bg-zinc-950 p-3" value={email} onChange={e=>setEmail(e.target.value)} /><input className="mt-3 w-full rounded-xl border border-zinc-800 bg-zinc-950 p-3" type="password" value={password} onChange={e=>setPassword(e.target.value)} /><button type="button" onClick={()=>setOk(Boolean(email&&password))} className="mt-4 w-full rounded-xl bg-zinc-100 p-3 text-sm font-semibold text-zinc-950">Continue</button></div></main>;
}
