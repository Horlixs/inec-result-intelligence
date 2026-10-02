import { createClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined;

export const supabase = url && key ? createClient(url, key) : null;

export async function portalAuthenticate(email: string, password: string): Promise<{ ok: boolean; error?: string }> {
  if (!supabase) return { ok: false, error: "Portal authentication is not configured." };

  const normalizedEmail = email.trim();
  const login = await supabase.auth.signInWithPassword({ email: normalizedEmail, password });

  if (!login.error) {
    const admin = await supabase.rpc("is_admin");

    if (admin.error) {
      await supabase.auth.signOut();
      return { ok: false, error: admin.error.message };
    }

    if (admin.data === true) return { ok: true };

    const claim = await supabase.rpc("bootstrap_first_admin");
    if (!claim.error && claim.data === true) return { ok: true };

    await supabase.auth.signOut();
    return {
      ok: false,
      error: claim.error?.message ?? "This account is not the portal administrator."
    };
  }

  const created = await supabase.auth.signUp({ email: normalizedEmail, password });

  if (created.error) return { ok: false, error: login.error.message };

  if (!created.data.session) {
    return {
      ok: false,
      error: "Administrator account created. Confirm the email, then sign in with these same credentials."
    };
  }

  const claim = await supabase.rpc("bootstrap_first_admin");

  if (claim.error || claim.data !== true) {
    await supabase.auth.signOut();
    return {
      ok: false,
      error: claim.error?.message ?? "Could not initialize the first administrator."
    };
  }

  return { ok: true };
}


export async function portalGetSession() {
  if (!supabase) return null;
  const result = await supabase.auth.getSession();
  return result.data.session ?? null;
}

export async function portalIsAdmin(): Promise<boolean> {
  if (!supabase) return false;
  const result = await supabase.rpc("is_admin");
  return !result.error && result.data === true;
}

export function portalAuthListener(callback: (session: unknown) => void) {
  if (!supabase) return null;
  return supabase.auth.onAuthStateChange((_event, session) => callback(session));
}

export async function portalSignOut() {
  if (supabase) await supabase.auth.signOut();
}
