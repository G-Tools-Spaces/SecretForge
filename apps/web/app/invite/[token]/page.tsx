'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { api, InvitePreview } from '@/lib/api';
import { useUser } from '@/lib/useUser';
import { InlineError } from '@/components/ui';

/**
 * Public invite landing page. Shows a minimal preview (org name, role, masked
 * email) and lets a signed-in user accept. Signed-out users are sent to
 * /login?next=/invite/<token> and come straight back after auth.
 */
export default function InvitePage() {
  const { token } = useParams<{ token: string }>();
  const router = useRouter();
  const { user, loading } = useUser();

  const [preview, setPreview] = useState<InvitePreview | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [fetching, setFetching] = useState(true);
  const [accepting, setAccepting] = useState(false);
  const [acceptError, setAcceptError] = useState<string | null>(null);

  useEffect(() => {
    if (!token) return;
    fetch(`/api/invites/${encodeURIComponent(token)}`)
      .then(async (res) => {
        const body = await res.json().catch(() => null);
        if (!res.ok) throw new Error(body?.message ?? 'This invite link is invalid or has expired');
        setPreview(body as InvitePreview);
      })
      .catch((err) => setPreviewError(err instanceof Error ? err.message : 'Failed to load invite'))
      .finally(() => setFetching(false));
  }, [token]);

  const accept = async () => {
    setAccepting(true);
    setAcceptError(null);
    try {
      await api('/invites/accept', { method: 'POST', body: JSON.stringify({ token }) });
      router.push('/projects');
    } catch (err) {
      setAcceptError(err instanceof Error ? err.message : 'Failed to accept invite');
      setAccepting(false);
    }
  };

  const next = encodeURIComponent(`/invite/${token}`);

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
      <div style={{ width: '100%', maxWidth: 400, display: 'flex', flexDirection: 'column', gap: 20 }}>
        <Link
          href="/"
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 10,
            fontWeight: 700,
            fontSize: 18,
            color: 'var(--text)',
            textDecoration: 'none',
          }}
        >
          Secret<span style={{ color: 'var(--accent-soft)' }}>Forge</span>
        </Link>

        <div className="panel">
          {fetching ? (
            <div className="panel-body" style={{ display: 'flex', justifyContent: 'center', padding: 32 }}>
              <span className="spinner" />
            </div>
          ) : previewError ? (
            <>
              <div className="panel-header" style={{ flexDirection: 'column', alignItems: 'flex-start', gap: 4 }}>
                <h1 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>Invite unavailable</h1>
              </div>
              <div className="panel-body" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                <InlineError message={previewError} />
                <p className="muted" style={{ margin: 0, fontSize: 13 }}>
                  Ask an org admin to send you a fresh invite link.
                </p>
                <Link href="/login" className="btn" style={{ textAlign: 'center', textDecoration: 'none' }}>
                  Go to sign in
                </Link>
              </div>
            </>
          ) : preview ? (
            <>
              <div className="panel-header" style={{ flexDirection: 'column', alignItems: 'flex-start', gap: 4 }}>
                <h1 style={{ margin: 0, fontSize: 18, fontWeight: 700, letterSpacing: '-0.01em' }}>
                  You're invited
                </h1>
                <span className="muted" style={{ fontSize: 13 }}>
                  Join <strong style={{ color: 'var(--text)' }}>{preview.orgName}</strong> on SecretForge.
                </span>
              </div>
              <div className="panel-body" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                <div style={{ fontSize: 13, display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span className="muted">Organization</span>
                    <strong style={{ fontWeight: 600 }}>{preview.orgName}</strong>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span className="muted">Org role</span>
                    <span className="badge badge-accent">{preview.role}</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span className="muted">Invited email</span>
                    <span className="mono" style={{ fontSize: 12 }}>
                      {preview.emailMasked}
                    </span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span className="muted">Expires</span>
                    <span>{new Date(preview.expiresAt).toLocaleDateString()}</span>
                  </div>
                </div>

                <InlineError message={acceptError} />

                {loading ? (
                  <div style={{ display: 'flex', justifyContent: 'center' }}>
                    <span className="spinner" />
                  </div>
                ) : user ? (
                  <>
                    <button className="btn btn-primary" style={{ width: '100%' }} disabled={accepting} onClick={accept}>
                      {accepting ? <span className="spinner" /> : `Accept invite as ${user.email}`}
                    </button>
                    <p className="subtle" style={{ margin: 0, fontSize: 12, textAlign: 'center' }}>
                      Not you?{' '}
                      <Link href={`/login?next=${next}`} style={{ color: 'var(--accent-soft)' }}>
                        Sign in with the invited account
                      </Link>
                    </p>
                  </>
                ) : (
                  <>
                    <Link
                      href={`/login?next=${next}`}
                      className="btn btn-primary"
                      style={{ width: '100%', textAlign: 'center', textDecoration: 'none' }}
                    >
                      Sign in to accept
                    </Link>
                    <p className="subtle" style={{ margin: 0, fontSize: 12, textAlign: 'center' }}>
                      The invite only works for the invited email address.
                    </p>
                  </>
                )}
              </div>
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}
