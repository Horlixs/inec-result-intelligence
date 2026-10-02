import { FormEvent, ReactNode, useEffect, useState } from "react";
import { LogIn, LogOut, ShieldCheck } from "lucide-react";
import { supabase } from "../lib/supabase";

interface AdminGateProps {
  children: ReactNode;
}

export function AdminGate({ children }: AdminGateProps) {
  const [loading, setLoading] = useState(true);
  const [checkingAdmin, setCheckingAdmin] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");

  async function checkAdmin() {
    if (!supabase) {
      setIsAdmin(false);
      setError("Portal authentication is not configured.");
      return;
    }

    setCheckingAdmin(true);
    const { data, error: rpcError } = await supabase.rpc("is_admin");
    setCheckingAdmin(false);

    if (rpcError) {
      setIsAdmin(false);
      setError(rpcError.message);
      return;
    }

    setIsAdmin(data === true);
    if (data === true) setError("");
  }

  useEffect(() => {
    if (!supabase) {
      setLoading(false);
      setError("Portal authentication is not configured.");
      return;
    }

    let mounted = true;

    supabase.auth.getSession().then(async ({ data, error: sessionError }) => {
      if (!mounted) return;

      if (sessionError) {
        setError(sessionError.message);
        setLoading(false);
        return;
      }

      if (data.session) await checkAdmin();
      setLoading(false);
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!session) {
        setIsAdmin(false);
        setLoading(false);
        return;
      }

      void checkAdmin();
    });

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, []);

  async function signIn(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!supabase) {
      setError("Portal authentication is not configured.");
      return;
    }

    setError("");
    setCheckingAdmin(true);

    const { error: signInError } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    });

    if (signInError) {
      setCheckingAdmin(false);
      setError(signInError.message);
      return;
    }

    const { data, error: adminError } = await supabase.rpc("is_admin");
    setCheckingAdmin(false);

    if (adminError) {
      await supabase.auth.signOut();
      setError(adminError.message);
      return;
    }

    if (data !== true) {
      await supabase.auth.signOut();
      setError("These credentials are valid, but this account is not an authorized portal administrator.");
      return;
    }

    setIsAdmin(true);
    setPassword("");
  }

  async function signOut() {
    if (!supabase) return;
    await supabase.auth.signOut();
    setIsAdmin(false);
    setEmail("");
    setPassword("");
  }

  if (loading) {
    return (
      <div className="grid min-h-screen place-items-center bg-[#07090d] text-zinc-100">
        <div className="flex items-center gap-3 text-sm text-zinc-400">
          <ShieldCheck size={18} />
          Checking administrator access…
        </div>
      </div>
    );
  }

  if (isAdmin) {
    return (
      <div className="relative">
        {children}
        <button
          type="button"
          onClick={() => void signOut()}
          className="fixed bottom-5 right-5 z-[60] inline-flex items-center gap-2 rounded-xl border border-zinc-800 bg-zinc-950/95 px-3 py-2 text-xs font-medium text-zinc-300 shadow-xl shadow-black/30 backdrop-blur hover:bg-zinc-900"
        >
          <LogOut size={14} />
          Sign out
        </button>
      </div>
    );
  }

  return (
    <main className="grid min-h-screen place-items-center bg-[#07090d] px-4 text-zinc-100">
      <section className="w-full max-w-md rounded-3xl border border-zinc-800/70 bg-zinc-900/70 p-7 shadow-2xl shadow-black/30 backdrop-blur-xl">
        <div className="mb-7 flex items-start gap-4">
          <div className="grid size-11 shrink-0 place-items-center rounded-xl bg-zinc-100 text-sm font-bold text-zinc-950">
            IR
          </div>
          <div>
            <p className="font-display text-lg font-semibold tracking-tight">INEC Intelligence</p>
            <p className="mt-1 text-xs leading-5 text-zinc-500">
              Administrator sign-in is required before entering the portal.
            </p>
          </div>
        </div>

        <div className="mb-6 flex items-center gap-3 rounded-2xl border border-amber-500/15 bg-amber-500/5 p-4">
          <ShieldCheck className="shrink-0 text-amber-300" size={18} />
          <p className="text-xs leading-5 text-zinc-400">
            Use the administrator credentials created in Supabase Authentication.
          </p>
        </div>

        <form onSubmit={signIn} className="space-y-4">
          <label className="block">
            <span className="mb-2 block text-xs font-medium text-zinc-400">Administrator email</span>
            <input
              type="email"
              autoComplete="username"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              required
              className="w-full rounded-xl border border-zinc-800 bg-zinc-950/80 px-3.5 py-3 text-sm text-zinc-100 outline-none transition focus:border-zinc-600"
              placeholder="admin@example.com"
            />
          </label>

          <label className="block">
            <span className="mb-2 block text-xs font-medium text-zinc-400">Password</span>
            <input
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              required
              className="w-full rounded-xl border border-zinc-800 bg-zinc-950/80 px-3.5 py-3 text-sm text-zinc-100 outline-none transition focus:border-zinc-600"
              placeholder="Enter administrator password"
            />
          </label>

          {error && (
            <div className="rounded-xl border border-red-500/20 bg-red-500/5 px-3.5 py-3 text-xs leading-5 text-red-300">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={checkingAdmin}
            className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-zinc-100 px-4 py-3 text-sm font-semibold text-zinc-950 transition hover:bg-white disabled:cursor-not-allowed disabled:opacity-60"
          >
            <LogIn size={16} />
            {checkingAdmin ? "Signing in…" : "Sign in to portal"}
          </button>
        </form>
      </section>
    </main>
  );
}
