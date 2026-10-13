'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { auth } from '@/lib/api';

export default function LoginPage() {
  const router = useRouter();
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
      router.push('/projects');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
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
        padding: 24,
      }}
    >
      <div style={{ width: 360 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 28, justifyContent: 'center' }}>
          <div
            style={{
              width: 32,
              height: 32,
              borderRadius: 8,
              background: 'var(--ac)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#fff',
            }}
          >
            <i className="ti ti-lock" style={{ fontSize: 18 }} />
          </div>
          <span style={{ fontSize: 20, fontWeight: 600 }}>SecretForge</span>
        </div>

        <div className="card" style={{ padding: 24 }}>
          <div style={{ marginBottom: 18, textAlign: 'center' }}>
            <p style={{ fontSize: 16, fontWeight: 500, margin: '0 0 4px' }}>
              {mode === 'login' ? 'Welcome back' : 'Create your account'}
            </p>
            <p className="muted" style={{ margin: 0, fontSize: 12.5 }}>
              {mode === 'login'
                ? 'Sign in to your team secrets vault'
                : 'Start managing your team secrets'}
            </p>
          </div>

          <form onSubmit={submit}>
            {mode === 'signup' && (
              <div style={{ marginBottom: 12 }}>
                <label className="muted" style={{ display: 'block', fontSize: 11.5, marginBottom: 5 }}>
                  Name
                </label>
                <input
                  className="input"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Asha Verma"
                  autoComplete="name"
                />
              </div>
            )}
            <div style={{ marginBottom: 12 }}>
              <label className="muted" style={{ display: 'block', fontSize: 11.5, marginBottom: 5 }}>
                Email
              </label>
              <input
                className="input"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@team.com"
                required
                autoComplete="email"
              />
            </div>
            <div style={{ marginBottom: 18 }}>
              <label className="muted" style={{ display: 'block', fontSize: 11.5, marginBottom: 5 }}>
                Password
              </label>
              <input
                className="input"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder={mode === 'signup' ? 'At least 10 characters' : '••••••••'}
                required
                autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
              />
            </div>

            {error && (
              <p style={{ color: 'var(--danger)', fontSize: 12.5, margin: '0 0 12px' }}>{error}</p>
            )}

            <button className="btn primary" style={{ width: '100%', justifyContent: 'center' }} disabled={busy}>
              {busy ? <span className="spinner" /> : mode === 'login' ? 'Sign in' : 'Create account'}
            </button>
          </form>

          <p className="muted" style={{ textAlign: 'center', margin: '16px 0 0', fontSize: 12 }}>
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
                  style={{ color: 'var(--al)' }}
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
                  style={{ color: 'var(--al)' }}
                >
                  Sign in
                </a>
              </>
            )}
          </p>
        </div>
      </div>
    </div>
  );
}
