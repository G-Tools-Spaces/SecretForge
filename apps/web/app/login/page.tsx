'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { auth } from '@/lib/api';
import { useUser } from '@/lib/useUser';
import { InlineError } from '@/components/ui';

export default function LoginPage() {
  const router = useRouter();
  const { refresh } = useUser();
  const [mode, setMode] = useState<'login' | 'signup'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      if (mode === 'login') {
        await auth.login(email, password);
      } else {
        await auth.signup(email, password, name || undefined);
      }
      // Update the UserProvider context BEFORE navigating — it cached
      // user=null from the initial (unauthenticated) /auth/me check, and
      // /projects would bounce us straight back to /login otherwise.
      await refresh();
      router.push('/projects');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
      setBusy(false);
    }
  };

  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 16,
        backgroundImage: 'radial-gradient(#2e2e33 1px, transparent 1px)',
        backgroundSize: '18px 18px',
      }}
    >
      <div style={{ width: '100%', maxWidth: 380, display: 'flex', flexDirection: 'column', gap: 20 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontWeight: 700 }}>
          <span
            style={{
              width: 28,
              height: 28,
              background: 'var(--accent-strong)',
              color: '#fff',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 14,
            }}
          >
            S
          </span>
          SecretForge
        </div>

        <div className="panel">
          <div className="panel-header" style={{ flexDirection: 'column', alignItems: 'flex-start', gap: 4 }}>
            <h1 style={{ margin: 0, fontSize: 18, fontWeight: 700, letterSpacing: '-0.01em' }}>
              {mode === 'login' ? 'Sign in' : 'Create your account'}
            </h1>
            <span className="muted" style={{ fontSize: 13 }}>
              {mode === 'login'
                ? 'Sign in to your team secrets vault.'
                : 'Start managing your team secrets. Password must be at least 10 characters.'}
            </span>
          </div>
          <div className="panel-body">
            <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              {mode === 'signup' && (
                <div className="field">
                  <label className="field-label" htmlFor="name">
                    Name
                  </label>
                  <input
                    id="name"
                    className="input"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Asha Verma"
                    autoComplete="name"
                  />
                </div>
              )}
              <div className="field">
                <label className="field-label" htmlFor="email">
                  Email
                </label>
                <input
                  id="email"
                  className="input"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@team.com"
                  required
                  autoComplete="email"
                />
              </div>
              <div className="field">
                <label className="field-label" htmlFor="password">
                  Password
                </label>
                <input
                  id="password"
                  className="input"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder={mode === 'signup' ? 'At least 10 characters' : '••••••••'}
                  required
                  autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                />
              </div>

              <InlineError message={error} />

              <button className="btn btn-primary" style={{ width: '100%' }} disabled={busy}>
                {busy ? <span className="spinner" /> : mode === 'login' ? 'Sign in' : 'Create account'}
              </button>
            </form>
          </div>
        </div>

        <p className="subtle" style={{ margin: 0, fontSize: 12, textAlign: 'center' }}>
          {mode === 'login' ? (
            <>
              No account?{' '}
              <a
                href="#"
                onClick={(e) => {
                  e.preventDefault();
                  setMode('signup');
                  setError(null);
                }}
              >
                Sign up
              </a>
            </>
          ) : (
            <>
              Have an account?{' '}
              <a
                href="#"
                onClick={(e) => {
                  e.preventDefault();
                  setMode('login');
                  setError(null);
                }}
              >
                Sign in
              </a>
            </>
          )}
        </p>
      </div>
    </div>
  );
}
