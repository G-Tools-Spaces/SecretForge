'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { api } from '@/lib/api';
import { useUser } from '@/lib/useUser';
import { InlineError } from '@/components/ui';

/**
 * Approve page for browser-based CLI login (`forge login`).
 *
 * The CLI opens /auth/cli/start on the API, which 302s here with ?port=&
 * state=. The user must be signed in (any method — password, Google, GitHub,
 * with 2FA); if not, we bounce to /login and come back. On Approve we mint a
 * single-use code via the API, then redirect the browser to the CLI's
 * localhost callback. If that redirect can't work (CLI on another/headless
 * machine), the user copies the code and runs `forge login --code <code>`.
 */
export default function CliAuthPage() {
  const router = useRouter();
  const { user, loading } = useUser();
  const [params, setParams] = useState<{ port: number; state: string } | null>(null);
  const [invalid, setInvalid] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [code, setCode] = useState<string | null>(null);

  // Parse + validate the query string once (client-side).
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    const port = Number(q.get('port'));
    const state = q.get('state') ?? '';
    if (!Number.isInteger(port) || port < 1 || port > 65535 || !/^[a-f0-9]{16,64}$/.test(state)) {
      setInvalid(true);
      return;
    }
    setParams({ port, state });
  }, []);

  // Require a signed-in user; come back here afterwards.
  useEffect(() => {
    if (!loading && !user && params) {
      router.push(`/login?next=${encodeURIComponent(`/cli-auth?port=${params.port}&state=${params.state}`)}`);
    }
  }, [loading, user, params, router]);

  const approve = async () => {
    if (!params) return;
    setBusy(true);
    setError(null);
    try {
      const { code } = await api<{ code: string }>('/auth/cli/authorize', { method: 'POST' });
      setCode(code);
      // Hand the code to the waiting CLI. If nothing is listening (headless
      // box), the browser shows a connection error — the user comes back here
      // and copies the code instead.
      const target = `http://127.0.0.1:${params.port}/callback?code=${encodeURIComponent(code)}&state=${params.state}`;
      setTimeout(() => window.location.assign(target), 1200);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not authorize the CLI');
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
      <div style={{ width: '100%', maxWidth: 380 }}>
        <div className="panel">
          <div className="panel-body" style={{ display: 'flex', flexDirection: 'column', gap: 14, padding: 24 }}>
            {invalid ? (
              <>
                <h1 style={{ margin: 0, fontSize: 16, fontWeight: 700 }}>Invalid CLI login link</h1>
                <p className="muted" style={{ margin: 0, fontSize: 13 }}>
                  This link is malformed. Run <code>forge login</code> again from your terminal.
                </p>
              </>
            ) : loading || !user || !params ? (
              <>
                <span className="spinner" style={{ alignSelf: 'center' }} />
                <p className="muted" style={{ margin: 0, fontSize: 13, textAlign: 'center' }}>Loading…</p>
              </>
            ) : code ? (
              <>
                <h1 style={{ margin: 0, fontSize: 16, fontWeight: 700 }}>Handing off to your CLI…</h1>
                <p className="muted" style={{ margin: 0, fontSize: 13 }}>
                  Redirecting to the CLI on this machine. If you see a connection error (the CLI is on
                  another or headless machine), come back here, copy this code and run{' '}
                  <code>{'forge login --code <code>'}</code>:
                </p>
                <code
                  className="mono"
                  style={{
                    display: 'block',
                    padding: '10px 12px',
                    background: 'var(--bg-2, rgba(255,255,255,0.04))',
                    border: '1px solid var(--border)',
                    fontSize: 12,
                    wordBreak: 'break-all',
                    userSelect: 'all',
                  }}
                >
                  {code}
                </code>
              </>
            ) : (
              <>
                <h1 style={{ margin: 0, fontSize: 16, fontWeight: 700 }}>Authorize the SecretForge CLI?</h1>
                <p className="muted" style={{ margin: 0, fontSize: 13 }}>
                  A terminal session is asking to sign in as <strong>{user.email}</strong>. Only approve if
                  you just ran <code>forge login</code> yourself.
                </p>
                <InlineError message={error} />
                <button className="btn btn-primary" style={{ width: '100%' }} disabled={busy} onClick={approve}>
                  {busy ? <span className="spinner" /> : 'Approve CLI sign-in'}
                </button>
                <Link
                  href="/projects"
                  className="btn"
                  style={{ textAlign: 'center', textDecoration: 'none', justifyContent: 'center' }}
                >
                  Cancel
                </Link>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
