'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { auth } from '@/lib/api';
import { useUser } from '@/lib/useUser';
import { InlineError } from '@/components/ui';

function GoogleIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" aria-hidden="true">
      <path
        fill="#EA4335"
        d="M12 5.04c1.62 0 3.06.56 4.2 1.64l3.12-3.12C17.46 2.09 14.96 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84C6.71 7.31 9.14 5.04 12 5.04z"
      />
      <path
        fill="#4285F4"
        d="M23.49 12.27c0-.79-.07-1.54-.19-2.27H12v4.51h6.47c-.29 1.48-1.14 2.73-2.4 3.58l3.68 2.85c2.15-1.99 3.74-4.92 3.74-8.67z"
      />
      <path
        fill="#FBBC05"
        d="M5.84 14.09a7.2 7.2 0 0 1 0-4.18L2.18 7.07a11 11 0 0 0 0 9.86l3.66-2.84z"
      />
      <path
        fill="#34A853"
        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.68-2.85c-.98.66-2.23 1.06-3.6 1.06-2.86 0-5.29-2.27-6.16-5.05l-3.66 2.84C3.99 20.53 7.7 23 12 23z"
      />
    </svg>
  );
}

function GithubIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" aria-hidden="true" fill="currentColor">
      <path d="M12 .5C5.65.5.5 5.65.5 12c0 5.08 3.29 9.39 7.86 10.91.58.11.79-.25.79-.55 0-.27-.01-1.17-.02-2.12-3.2.7-3.87-1.36-3.87-1.36-.52-1.33-1.28-1.68-1.28-1.68-1.04-.71.08-.7.08-.7 1.15.08 1.76 1.18 1.76 1.18 1.03 1.76 2.69 1.25 3.35.96.1-.75.4-1.25.72-1.54-2.55-.29-5.23-1.28-5.23-5.68 0-1.26.45-2.28 1.18-3.09-.12-.29-.51-1.46.11-3.05 0 0 .96-.31 3.15 1.18a10.9 10.9 0 0 1 5.74 0c2.19-1.49 3.15-1.18 3.15-1.18.62 1.59.23 2.76.11 3.05.74.81 1.18 1.83 1.18 3.09 0 4.41-2.69 5.38-5.25 5.67.41.35.77 1.05.77 2.12 0 1.53-.01 2.76-.01 3.14 0 .3.2.67.8.55A11.51 11.51 0 0 0 23.5 12C23.5 5.65 18.35.5 12 .5z" />
    </svg>
  );
}

export default function LoginPage() {
  const router = useRouter();
  const { refresh } = useUser();
  const [mode, setMode] = useState<'login' | 'signup'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Post-auth redirect target, e.g. /login?next=/invite/<token>.
  const [next, setNext] = useState<string | null>(null);

   const [providers, setProviders] = useState<{ google: boolean; github: boolean }>({ google: false, github: false });

   useEffect(() => {
     const param = new URLSearchParams(window.location.search).get('next');
     // Only allow same-origin absolute paths (block "//evil.com" etc.).
     if (param && param.startsWith('/') && !param.startsWith('//')) setNext(param);
     auth.providers().then(setProviders);
   }, []);

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
      router.push(next ?? '/projects');
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
            {(providers.google || providers.github) && (
              <>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 14 }}>
                  {providers.google && (
                    <a
                      className="btn"
                      style={{ textDecoration: 'none', justifyContent: 'center', gap: 8 }}
                      href={`/api/auth/google${next ? `?next=${encodeURIComponent(next)}` : ''}`}
                    >
                      <GoogleIcon />
                      Continue with Google
                    </a>
                  )}
                  {providers.github && (
                    <a
                      className="btn"
                      style={{ textDecoration: 'none', justifyContent: 'center', gap: 8 }}
                      href={`/api/auth/github${next ? `?next=${encodeURIComponent(next)}` : ''}`}
                    >
                      <GithubIcon />
                      Continue with GitHub
                    </a>
                  )}
                </div>
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 10,
                    marginBottom: 14,
                    color: 'var(--text-4)',
                    fontSize: 11,
                    textTransform: 'uppercase',
                    letterSpacing: '0.08em',
                  }}
                >
                  <span style={{ flex: 1, height: 1, background: 'var(--border)' }} />
                  or with email
                  <span style={{ flex: 1, height: 1, background: 'var(--border)' }} />
                </div>
              </>
            )}
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
