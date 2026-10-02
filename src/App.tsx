import { useEffect, useState } from "react";
import { supabase } from "./lib/supabase";
import { AppShell } from "./AppShell";
import { ElectionDirectory } from "./components/ElectionDirectory";
import { ElectionProfile } from "./components/ElectionProfile";
import { RecentElections } from "./components/RecentElections";
import { AnalyticsWorkspace, CandidatesWorkspace, ResultsWorkspace } from "./components/WorkspacePages";

function AdminPortal({ children }: { children: any }) {
  const [loading, setLoading] = useState(true);
  const [admin, setAdmin] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    if (!supabase) { setLoading(false); return; }
    supabase.auth.getSession().then(async ({ data }) => {
      if (data.session) {
        const { data: isAdmin } = await supabase.rpc("is_admin");
        setAdmin(isAdmin === true);
      }
      setLoading(false);
    });
  }, []);

  async function authenticate() {
    if (!supabase) return;
    setError("");
    const existing = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    if (!existing.error) {
      const { data, error: adminError } = await supabase.rpc("is_admin");
      if (adminError) { setError(adminError.message); await supabase.auth.signOut(); return; }
      if (data === true) { setAdmin(true); return; }
      await supabase.auth.signOut();
      setError("This account is not the portal administrator.");
      return;
    }

    const created = await supabase.auth.signUp({ email: email.trim(), password });
    if (created.error) { setError(created.error.message); return; }
    if (!created.data.session) {
      setError("Administrator account created. Confirm the email, then sign in with the same credentials.");
      return;
    }
    const { data: claimed, error: claimError } = await supabase.rpc("bootstrap_first_admin");
    if (claimError || claimed !== true) {
      setError(claimError?.message ?? "The first administrator could not be initialized.");
      await supabase.auth.signOut();
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
  if (admin) return <>{children}<button type="button" onClick={() => void signOut()} className="fixed bottom-5 right-5 z-[60] rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2 text-xs text-zinc-300 shadow-xl">Sign out</button></>;

  return <main className="grid min-h-screen place-items-center bg-[#07090d] px-4 text-zinc-100">
    <div className="w-full max-w-md rounded-3xl border border-zinc-800 bg-zinc-900/80 p-7 shadow-2xl">
      <div className="mb-7"><p className="font-display text-xl font-semibold">INEC Intelligence</p><p className="mt-2 text-xs leading-5 text-zinc-500">Enter the administrator credentials to access the portal.</p></div>
      <label className="block"><span className="mb-2 block text-xs text-zinc-400">Email</span><input type="email" autoComplete="username" value={email} onChange={e => setEmail(e.target.value)} required className="w-full rounded-xl border border-zinc-800 bg-zinc-950 px-3.5 py-3 text-sm outline-none" /></label>
      <label className="mt-4 block"><span className="mb-2 block text-xs text-zinc-400">Password</span><input type="password" autoComplete="current-password" value={password} onChange={e => setPassword(e.target.value)} required className="w-full rounded-xl border border-zinc-800 bg-zinc-950 px-3.5 py-3 text-sm outline-none" /></label>
      {error && <p className="mt-4 rounded-xl border border-red-500/20 bg-red-500/5 p-3 text-xs leading-5 text-red-300">{error}</p>}
      <button type="button" onClick={() => void authenticate()} className="mt-5 w-full rounded-xl bg-zinc-100 px-4 py-3 text-sm font-semibold text-zinc-950">Continue</button>
    </div>
  </main>;
}

function Placeholder({ title }: { title: string }) {
  return <div className="rounded-3xl border border-zinc-800/60 bg-zinc-900/35 p-12 text-center"><p className="text-sm font-medium text-zinc-300">{title}</p><p className="mt-2 text-xs text-zinc-600">This workspace is ready for the corresponding evidence module.</p></div>;
}

function electionIdFromPath(pathname: string): string | null {
  const match = pathname.match(/^\/elections\/([^/]+)\/results\/?$/);
  return match ? decodeURIComponent(match[1]) : null;
}

export default function App() {
  const [pathname, setPathname] = useState(() => window.location.pathname);

  useEffect(() => {
    const handlePopState = () => setPathname(window.location.pathname);
    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, []);

  function navigate(to: string) {
    if (window.location.pathname !== to) window.history.pushState({}, "", to);
    setPathname(window.location.pathname);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  const electionId = electionIdFromPath(pathname);

  let page;
  if (pathname === "/") {
    page = <RecentElections onSelect={(id) => navigate("/elections/" + id + "/results")} />;
  } else if (pathname === "/results") {
    page = <ResultsWorkspace onSelectElection={(id) => navigate("/elections/" + id + "/results")} />;
  } else if (pathname === "/candidates") {
    page = <CandidatesWorkspace />;
  } else if (pathname === "/analytics") {
    page = <AnalyticsWorkspace />;
  } else if (pathname === "/elections") {
    page = <ElectionDirectory />;
  } else if (electionId) {
    page = <ElectionProfile selectedElectionId={electionId} detailOnly onElectionSelect={(id) => navigate("/elections/" + id + "/results")} onBackToElections={() => navigate("/elections")} />;
  } else if (pathname === "/view") {
    page = <Placeholder title="Result review" />;
  } else if (pathname === "/evidence") {
    page = <Placeholder title="Result evidence" />;
  } else if (pathname === "/sources") {
    page = <Placeholder title="Data sources" />;
  } else {
    page = <Placeholder title="Page not found" />;
  }

  return <AdminPortal><AppShell pathname={pathname} onNavigate={navigate}>{page}</AppShell></AdminPortal>;
}
