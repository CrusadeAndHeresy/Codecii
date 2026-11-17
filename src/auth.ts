import { createClient, isAuthRetryableFetchError } from '@supabase/supabase-js';
import { ALLOWED_EMAIL, decideAccess, type Access } from './access';

// The publishable key is designed to be public. What protects the data is the sign-in and the row-level security
// policies on the rl_ tables; neither depends on this key staying secret.
const SUPABASE_URL = 'https://lderoeoqilbnrhgyuxui.supabase.co';
const SUPABASE_KEY = 'sb_publishable_4RquNxPgGDtFwZVvY7426Q_sKqRmXEt';

const SEEN_KEY = 'rl-signed-in-before';
const seen = {
  get: () => { try { return localStorage.getItem(SEEN_KEY) === '1'; } catch { return false; } },
  set: () => { try { localStorage.setItem(SEEN_KEY, '1'); } catch { /* storage unavailable */ } },
  clear: () => { try { localStorage.removeItem(SEEN_KEY); } catch { /* storage unavailable */ } },
};

export const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
});

export { ALLOWED_EMAIL };
export type { Access };

const TIMEOUT = Symbol('timeout');

// What the app should do on load: let in, show the sign-in screen, or reject the account.
export async function checkAccess(): Promise<Access> {
  const result = await Promise.race([
    supabase.auth.getSession(),
    new Promise<typeof TIMEOUT>((resolve) => setTimeout(() => resolve(TIMEOUT), 5000)),
  ]);
  const online = typeof navigator === 'undefined' ? true : navigator.onLine;
  if (result === TIMEOUT) return decideAccess({ email: null, online, seenBefore: seen.get(), networkError: true });
  const { data, error } = result;
  const access = decideAccess({
    email: data.session?.user.email, online, seenBefore: seen.get(),
    networkError: !!error && isAuthRetryableFetchError(error),
  });
  if (access === 'wrong-account') await supabase.auth.signOut();
  if (access === 'allowed') seen.set();
  return access;
}

export async function signIn(email: string, password: string): Promise<{ ok: true } | { ok: false; message: string }> {
  const { data, error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
  if (error) {
    return { ok: false, message: isAuthRetryableFetchError(error) ? 'No connection. You need to be online to sign in.' : 'Email or password is wrong.' };
  }
  if (decideAccess({ email: data.user?.email, online: true, seenBefore: false, networkError: false }) !== 'allowed') {
    await supabase.auth.signOut();
    return { ok: false, message: 'This account is not allowed to use this app.' };
  }
  seen.set();
  return { ok: true };
}

export async function signOut(): Promise<void> {
  seen.clear();
  await supabase.auth.signOut();
}

// Fires when the session ends or is replaced (sign-out here, or a revoked session).
export function onSessionChange(cb: (signedIn: boolean) => void): () => void {
  const { data } = supabase.auth.onAuthStateChange((event, session) => {
    if (event === 'SIGNED_OUT') { seen.clear(); cb(false); }
    else if (session && (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED')) cb(true);
  });
  return () => data.subscription.unsubscribe();
}
