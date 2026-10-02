import { createClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined;

export const supabase = url && key ? createClient(url, key) : null;


export async function portalAuthenticate(email: string, password: string): Promise<{ ok: boolean; error?: string }> {
  if (!supabase) return { ok: false, error: "Portal authentication is not configured." };
  const login = await supabase.auth.signInWithPassword({ email: email.trim(), password });
  if (!login.error) {
    const admin = await supabase.rpc("is_admin");
    if (admin.data === true) return { ok: true };
    await supabase.auth.signOut();
    return { ok: false, error: "This account is not the portal administrator." };
  }
  const created = await supabase.auth.signUp({ email: email.trim(), password });
  if (created.error) return { ok: false, error: login.error.message };
  if (!created.data.session) return { ok: false, error: "Administrator account created. Confirm the email, then sign in with these same credentials." };
  const claim = await supabase.rpc("bootstrap_first_admin");
  if (claim.error || claim.data !== true) {
    await supabase.auth.signOut();
    return { ok: false, error: claim.error?.message ?? "Could not initialize the first administrator." };
  }
  return { ok: true };
}
