'use client';

import { useCallback, useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { api, CreatedToken, Project, ServiceTokenInfo } from '@/lib/api';
import { envLabel } from '@/lib/format';
import { useUser } from '@/lib/useUser';
import { ProjectShell } from '@/components/shell/AppShell';
import { Icon } from '@/components/Icon';
import { PageHeader, ErrorState, Modal } from '@/components/ui';
import { useToast } from '@/components/Toast';

/**
 * Service tokens (Phase 6): read-only, single-environment, expiring,
 * revocable tokens for CI/servers. The plaintext token is shown once.
 */
export default function TokensPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const router = useRouter();
  const { user, loading } = useUser();
  const toast = useToast();

  const [project, setProject] = useState<Project | null>(null);
  const [tokens, setTokens] = useState<ServiceTokenInfo[]>([]);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [showCreate, setShowCreate] = useState(false);
  const [name, setName] = useState('');
  const [env, setEnv] = useState('dev');
  const [expiresInDays, setExpiresInDays] = useState('30');
  const [creating, setCreating] = useState(false);
  const [created, setCreated] = useState<CreatedToken | null>(null);

  useEffect(() => {
    if (!loading && !user) router.push('/login');
  }, [loading, user, router]);

  const load = useCallback(async () => {
    if (!projectId) return;
    setBusy(true);
    try {
      const [p, t] = await Promise.all([
        api<Project>(`/projects/${projectId}`),
        api<{ tokens: ServiceTokenInfo[] }>(`/projects/${projectId}/tokens`),
      ]);
      setProject(p);
      setTokens(t.tokens);
      if (!p.environments.some((e) => e.name === env)) {
        setEnv(p.environments[0]?.name ?? 'dev');
      }
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load');
    } finally {
      setBusy(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  useEffect(() => {
    if (user) load();
  }, [user, load]);

  const isAdmin = project?.yourRole === 'ADMIN';

  const createToken = async () => {
    const days = parseInt(expiresInDays, 10);
    if (!name.trim() || Number.isNaN(days) || days < 1 || days > 365) return;
    setCreating(true);
    try {
      const t = await api<CreatedToken>(`/projects/${projectId}/envs/${env}/tokens`, {
        method: 'POST',
        body: JSON.stringify({ name: name.trim(), expiresInDays: days }),
      });
      setCreated(t);
      setShowCreate(false);
      setName('');
      setExpiresInDays('30');
      load();
    } catch (err) {
      toast.show(err instanceof Error ? err.message : 'Failed to create token', 'error');
    } finally {
      setCreating(false);
    }
  };

  const revoke = async (t: ServiceTokenInfo) => {
    if (!confirm(`Revoke token "${t.name}" (${t.environment})? Anything using it will lose access immediately.`)) return;
    try {
      await api(`/projects/${projectId}/tokens/${t.id}`, { method: 'DELETE' });
      toast.show(`Revoked ${t.name}`);
      load();
    } catch (err) {
      toast.show(err instanceof Error ? err.message : 'Failed to revoke', 'error');
    }
  };

  const copyCreated = async () => {
    if (!created) return;
    await navigator.clipboard.writeText(created.token);
    toast.show('Token copied to clipboard');
  };

  if (loading || !user || (!project && busy)) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <span className="spinner" />
      </div>
    );
  }

  if (!project) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
        <ErrorState message={error ?? 'Project not found'} onRetry={load} />
      </div>
    );
  }

  return (
    <ProjectShell project={project}>
      <div className="page">
        <PageHeader
          title="Service tokens"
          description="Read-only tokens scoped to one environment — for CI and servers. Expiring and revocable."
          actions={
            isAdmin ? (
              <button className="btn btn-primary" onClick={() => setShowCreate(true)}>
                <Icon name="plus" size={14} strokeWidth={2.2} />
                New token
              </button>
            ) : undefined
          }
        />

        {error && <ErrorState message={error} onRetry={load} />}

        <section className="panel">
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Environment</th>
                  <th>Token</th>
                  <th>Status</th>
                  <th>Expires</th>
                  <th>Last used</th>
                  {isAdmin && <th style={{ width: 1 }} />}
                </tr>
              </thead>
              <tbody>
                {tokens.length === 0 && (
                  <tr>
                    <td colSpan={isAdmin ? 7 : 6}>
                      <div className="empty">
                        No service tokens yet.
                        {isAdmin && ' Create one to use SecretForge from CI or servers.'}
                      </div>
                    </td>
                  </tr>
                )}
                {tokens.map((t) => {
                  const expired = !t.revokedAt && new Date(t.expiresAt).getTime() < Date.now();
                  const status = t.revokedAt ? 'revoked' : expired ? 'expired' : 'active';
                  return (
                    <tr key={t.id}>
                      <td style={{ fontWeight: 600, color: 'var(--text)' }}>{t.name}</td>
                      <td>
                        <span className="badge badge-accent">{envLabel(t.environment)}</span>
                      </td>
                      <td className="mono muted" style={{ fontSize: 12 }}>
                        {t.prefix ? `${t.prefix}…` : '—'}
                      </td>
                      <td>
                        <span
                          className={`badge ${
                            status === 'active' ? 'badge-ok' : status === 'expired' ? 'badge-warn' : 'badge-danger'
                          }`}
                        >
                          {status}
                        </span>
                      </td>
                      <td className="muted">{new Date(t.expiresAt).toLocaleDateString()}</td>
                      <td className="muted">{t.lastUsedAt ? new Date(t.lastUsedAt).toLocaleString() : 'never'}</td>
                      {isAdmin && (
                        <td>
                          {!t.revokedAt && (
                            <button className="btn btn-danger btn-sm" onClick={() => revoke(t)}>
                              <Icon name="trash" size={13} strokeWidth={2.2} />
                              Revoke
                            </button>
                          )}
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>

        <div className="notice" style={{ marginTop: 14 }}>
          Use a token via the <span className="mono">SECRETFORGE_TOKEN</span> env var — see the Integrate tab
          for CLI and CI examples. Tokens can read secrets but never write, and only from their own environment.
        </div>
      </div>

      {/* Create token */}
      {showCreate && (
        <Modal
          title="New service token"
          onClose={() => setShowCreate(false)}
          footer={
            <>
              <button className="btn" onClick={() => setShowCreate(false)}>
                Cancel
              </button>
              <button
                className="btn btn-primary"
                disabled={creating || !name.trim()}
                onClick={createToken}
              >
                {creating ? 'Creating…' : 'Create token'}
              </button>
            </>
          }
        >
          <div className="field">
            <label className="field-label" htmlFor="token-name">
              Name
            </label>
            <input
              id="token-name"
              className="input"
              placeholder="GitHub Actions — prod deploy"
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoFocus
            />
            <p className="field-help">A label so you remember what this token is for.</p>
          </div>
          <div className="field">
            <label className="field-label" htmlFor="token-env">
              Environment
            </label>
            <select id="token-env" className="select" value={env} onChange={(e) => setEnv(e.target.value)}>
              {project.environments.map((e) => (
                <option key={e.id} value={e.name}>
                  {envLabel(e.name)}
                </option>
              ))}
            </select>
            <p className="field-help">The token can only read secrets from this environment.</p>
          </div>
          <div className="field">
            <label className="field-label" htmlFor="token-expiry">
              Expires in (days)
            </label>
            <input
              id="token-expiry"
              className="input"
              type="number"
              min={1}
              max={365}
              value={expiresInDays}
              onChange={(e) => setExpiresInDays(e.target.value)}
            />
            <p className="field-help">1–365 days. Shorter is safer — rotate often.</p>
          </div>
        </Modal>
      )}

      {/* Show-once token reveal */}
      {created && (
        <Modal
          title="Token created"
          onClose={() => setCreated(null)}
          width={520}
          footer={
            <>
              <button className="btn" onClick={copyCreated}>
                <Icon name="copy" size={14} strokeWidth={2.2} />
                Copy token
              </button>
              <button className="btn btn-primary" onClick={() => setCreated(null)}>
                Done
              </button>
            </>
          }
        >
          <p style={{ margin: '0 0 10px', fontSize: 13, color: 'var(--text-2)' }}>
            <strong style={{ color: 'var(--warn-soft)' }}>Shown once.</strong> Store it somewhere safe — we only
            keep a hash, so it can never be recovered.
          </p>
          <pre className="code-block mono" style={{ userSelect: 'all', wordBreak: 'break-all', whiteSpace: 'pre-wrap' }}>
            {created.token}
          </pre>
          <p style={{ margin: '10px 0 0', fontSize: 12, color: 'var(--text-3)' }}>
            {created.name} · {created.environment} · expires {new Date(created.expiresAt).toLocaleDateString()}
          </p>
        </Modal>
      )}
    </ProjectShell>
  );
}
