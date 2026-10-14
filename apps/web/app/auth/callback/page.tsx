'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { auth, ApiError } from '@/lib/api';
import { useUser } from '@/lib/useUser';
import { InlineError } from '@/components/ui';

/**
 * Landing page for social sign-in. The API redirects here with a single-use
 * exchange code (?code=…) which we redeem for real tokens, or with ?error=…
 * when the provider flow failed. Optional ?next= resumes the original target
 * (e.g. an invite link) after a successful exchange.
 *
 * When the account has 2FA enabled, the first exchange attempt is refused
 * with `totp_required` (and the code stays valid) — we then ask for the
 * authenticator code and re-submit it together with the exchange code.
 */
export default function AuthCallbackPage() {
  const router = useRouter();
  const { refresh } = useUser();
  const [error, setError] = useState<string | null>(null);
  const [fatal, setFatal] = useState(false);
  const [needsTotp, setNeedsTotp] = useState(false);
  const [totpCode, setTotpCode] = useState('');
  const [busy, setBusy] = useState(false);
  const started = useRef(false);
  // Kept in refs so the TOTP form submit can reuse them.
  const codeRef = useRef<string | null>(null);
  const nextRef = useRef<string>('/projects');

  useEffect(() => {
    if (started.current) return; // StrictMode double-invoke guard — the code is single-use
    started.current = true;

    const params = new URLSearchParams(window.location.search);
    const code = params.get('code');
    const errParam = params.get('error');
    const nextParam = params.get('next');
    nextRef.current =
      nextParam && nextParam.startsWith('/') && !nextParam.startsWith('//') ? nextParam : '/projects';

    if (errParam) {
      setError(errParam);
      setFatal(true);
      return;
    }
    if (!code) {
      setError('Missing sign-in code — please try again.');
      setFatal(true);
      return;
    }
    codeRef.current = code;

    (async () => {
      try {
        await auth.exchangeOAuthCode(code);
        await finish();
      } catch (err) {
        if (err instanceof ApiError && err.totpRequired) {
          // 2FA challenge: the exchange code was NOT consumed — ask for the
          // authenticator code and retry with it.
          setNeedsTotp(true);
          setError(null);
          return;
        }
        setError(err instanceof Error ? err.message : 'Social sign-in failed');
        setFatal(true);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Tokens are in — sync the user context, clean the URL, navigate. */
  const finish = async () => {
    await refresh();
    window.history.replaceState(null, '', '/auth/callback');
    router.push(nextRef.current);
  };

  const submitTotp = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!codeRef.current || totpCode.length !== 6) return;
    setBusy(true);
    setError(null);
    try {
      await auth.exchangeOAuthCode(codeRef.current, totpCode);
      await finish();
    } catch (err) {
      if (err instanceof ApiError && err.totpRequired) {
        // Wrong code — the exchange code is still valid; let the user retry.
        setError(err.message);
        setTotpCode('');
      } else {
        setError(err instanceof Error ? err.message : 'Social sign-in failed');
        setFatal(true);
      }
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
            {needsTotp && !fatal ? (
              <>
                <h1 style={{ margin: 0, fontSize: 16, fontWeight: 700 }}>Two-factor authentication</h1>
                <p className="muted" style={{ margin: 0, fontSize: 13 }}>
                  Your identity is verified — enter the 6-digit code from your authenticator app to finish
                  signing in.
                </p>
                <form onSubmit={submitTotp} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                  <div className="field">
                    <label className="field-label" htmlFor="totp">
                      Two-factor code
                    </label>
                    <input
                      id="totp"
                      className="input"
                      inputMode="numeric"
                      autoComplete="one-time-code"
                      value={totpCode}
                      onChange={(e) => setTotpCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                      placeholder="123456"
                      style={{ letterSpacing: '0.2em' }}
                      autoFocus
                    />
                  </div>
                  <InlineError message={error} />
                  <button className="btn btn-primary" style={{ width: '100%' }} disabled={busy || totpCode.length !== 6}>
                    {busy ? <span className="spinner" /> : 'Verify & sign in'}
                  </button>
                </form>
              </>
            ) : error ? (
              <>
                <h1 style={{ margin: 0, fontSize: 16, fontWeight: 700 }}>Sign-in failed</h1>
                <InlineError message={error} />
                <Link href="/login" className="btn btn-primary" style={{ textAlign: 'center', textDecoration: 'none' }}>
                  Back to sign in
                </Link>
              </>
            ) : (
              <>
                <span className="spinner" style={{ alignSelf: 'center' }} />
                <p className="muted" style={{ margin: 0, fontSize: 13, textAlign: 'center' }}>
                  Completing sign-in…
                </p>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
