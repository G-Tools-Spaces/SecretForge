'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { auth } from '@/lib/api';
import { useUser } from '@/lib/useUser';
import { InlineError } from '@/components/ui';

/**
 * Landing page for social sign-in. The API redirects here with a single-use
 * exchange code (?code=…) which we redeem for real tokens, or with ?error=…
 * when the provider flow failed. Optional ?next= resumes the original target
 * (e.g. an invite link) after a successful exchange.
 */
export default function AuthCallbackPage() {
  const router = useRouter();
  const { refresh } = useUser();
  const [error, setError] = useState<string | null>(null);
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return; // StrictMode double-invoke guard — the code is single-use
    started.current = true;

    const params = new URLSearchParams(window.location.search);
    const code = params.get('code');
    const errParam = params.get('error');
    const nextParam = params.get('next');
    const next = nextParam && nextParam.startsWith('/') && !nextParam.startsWith('//') ? nextParam : '/projects';

    if (errParam) {
      setError(errParam);
      return;
    }
    if (!code) {
      setError('Missing sign-in code — please try again.');
      return;
    }

    (async () => {
      try {
        await auth.exchangeOAuthCode(code);
        await refresh();
        // Clean the code out of the URL before navigating.
        window.history.replaceState(null, '', '/auth/callback');
        router.push(next);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Social sign-in failed');
      }
    })();
  }, [refresh, router]);

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
            {error ? (
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
