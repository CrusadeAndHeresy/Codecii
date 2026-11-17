import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { ALLOWED_EMAIL, checkAccess, onSessionChange, signIn, type Access } from './auth';

// Shows the app only to the signed-in owner. Everything else sees the sign-in screen.
export default function AuthGate({ children }: { children: ReactNode }) {
  const [access, setAccess] = useState<Access | 'loading'>('loading');
  const [email, setEmail] = useState(ALLOWED_EMAIL);
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  useEffect(() => {
    let live = true;
    checkAccess().then((a) => {
      if (!live) return;
      setAccess(a);
      if (a === 'wrong-account') setMessage('This account is not allowed to use this app.');
    });
    const off = onSessionChange((signedIn) => { if (live) setAccess(signedIn ? 'allowed' : 'sign-in'); });
    return () => { live = false; off(); };
  }, []);

  if (access === 'loading') return <div className="auth" aria-busy="true" />;
  if (access === 'allowed' || access === 'offline-allowed') return <>{children}</>;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true); setMessage('');
    const r = await signIn(email, password);
    setBusy(false);
    if (r.ok) { setPassword(''); setAccess('allowed'); } else setMessage(r.message);
  };

  return (
    <main className="auth">
      <form onSubmit={submit} className="auth-card">
        <h1>Rules Library</h1>
        <p className="muted">Sign in to continue.</p>
        <label>Email
          <input type="email" inputMode="email" autoComplete="username" autoCapitalize="none" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </label>
        <label>Password
          <input type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
        </label>
        {message && <p className="auth-error" role="alert">{message}</p>}
        <button type="submit" className="auth-go" disabled={busy || !password}>{busy ? 'Signing in…' : 'Sign in'}</button>
      </form>
    </main>
  );
}
