'use client';

import { useCallback, useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { api, Project, SecretRow } from '@/lib/api';
import { useUser } from '@/lib/useUser';
import { ProjectShell } from '@/components/shell/AppShell';
import { Icon } from '@/components/Icon';
import { PageHeader, Loading, ErrorState, Modal } from '@/components/ui';
import { useToast } from '@/components/Toast';

export default function SecretsPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const router = useRouter();
  const { user, loading } = useUser();
  const toast = useToast();

  const [project, setProject] = useState<Project | null>(null);
  const [env, setEnv] = useState('dev');
  const [secrets, setSecrets] = useState<SecretRow[]>([]);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [revealed, setRevealed] = useState<Record<string, string>>({});
  const [showAdd, setShowAdd] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [newKey, setNewKey] = useState('');
  const [newValue, setNewValue] = useState('');
  const [importContent, setImportContent] = useState('');

  useEffect(() => {
    if (!loading && !user) router.push('/login');
  }, [loading, user, router]);

  const load = useCallback(async () => {
    if (!projectId) return;
    setBusy(true);
    try {
      const [p, s] = await Promise.all([
        api<Project>(`/projects/${projectId}`),
        api<{ secrets: SecretRow[] }>(`/projects/${projectId}/envs/${env}/secrets`),
      ]);
      setProject(p);
      setSecrets(s.secrets);
      if (!p.environments.some((e) => e.name === env)) {
        setEnv(p.environments[0]?.name ?? 'dev');
      }
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load');
    } finally {
      setBusy(false);
    }
  }, [projectId, env]);

  useEffect(() => {
    if (user) load();
  }, [user, load]);

  const canWrite = project?.yourRole === 'ADMIN' || project?.yourRole === 'WRITE';
  const canAdmin = project?.yourRole === 'ADMIN';

  const reveal = async (key: string) => {
    try {
      const res = await api<{ value: string }>(`/projects/${projectId}/envs/${env}/secrets/${key}`);
      setRevealed((r) => ({ ...r, [key]: res.value }));
      setTimeout(() => {
        setRevealed((r) => {
          const next = { ...r };
          delete next[key];
          return next;
        });
      }, 30_000);
    } catch (err) {
      toast.show(err instanceof Error ? err.message : 'Failed to reveal', 'error');
    }
  };

  const addSecret = async () => {
    if (!newKey.trim() || !newValue) return;
    try {
      await api(`/projects/${projectId}/envs/${env}/secrets/${newKey.trim()}`, {
        method: 'PUT',
        body: JSON.stringify({ value: newValue }),
      });
      toast.show(`Set ${newKey.trim()} in ${env}`);
      setShowAdd(false);
      setNewKey('');
      setNewValue('');
      load();
    } catch (err) {
      toast.show(err instanceof Error ? err.message : 'Failed', 'error');
    }
  };

  const removeSecret = async (key: string) => {
    if (!confirm(`Delete secret ${key} and its entire version history? This cannot be undone.`)) return;
    try {
      await api(`/projects/${projectId}/envs/${env}/secrets/${key}`, { method: 'DELETE' });
      toast.show(`Deleted ${key}`);
      load();
    } catch (err) {
      toast.show(err instanceof Error ? err.message : 'Failed', 'error');
    }
  };

  const doImport = async () => {
    try {
      const res = await api<{ imported: number; created: number; updated: number }>(
        `/projects/${projectId}/envs/${env}/secrets/import`,
        { method: 'POST', body: JSON.stringify({ content: importContent }) },
      );
      toast.show(`Imported ${res.imported} secrets (${res.created} created, ${res.updated} updated)`);
      setShowImport(false);
      setImportContent('');
      load();
    } catch (err) {
      toast.show(err instanceof Error ? err.message : 'Import failed', 'error');
    }
  };

  const exportEnv = async () => {
    try {
      const res = await api<{ values: Record<string, string> }>(
        `/projects/${projectId}/envs/${env}/secrets/export`,
      );
      const text = Object.entries(res.values)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => `${k}=${v}`)
        .join('\n');
      await navigator.clipboard.writeText(text);
      toast.show(`Copied ${Object.keys(res.values).length} secrets to clipboard`);
    } catch (err) {
      toast.show(err instanceof Error ? err.message : 'Export failed', 'error');
    }
  };

  if (loading || !user) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <span className="spinner" />
      </div>
    );
  }

  if (!project && busy) {
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
          title="Secrets"
          description="Values are encrypted at rest (AES-256-GCM) and only decrypted on reveal."
          actions={
            <>
              <button className="btn" onClick={exportEnv}>
                <Icon name="copy" size={14} strokeWidth={2.2} />
                Copy all
              </button>
              {canWrite && (
                <>
                  <button className="btn" onClick={() => setShowImport(true)}>
                    <Icon name="upload" size={14} strokeWidth={2.2} />
                    Import .env
                  </button>
                  <button className="btn btn-primary" onClick={() => setShowAdd(true)}>
                    <Icon name="plus" size={14} strokeWidth={2.2} />
                    Add secret
                  </button>
                </>
              )}
            </>
          }
        />

        <div className="segmented">
          {project.environments.map((e) => (
            <button
              key={e.id}
              aria-pressed={env === e.name}
              onClick={() => {
                setEnv(e.name);
                setRevealed({});
              }}
            >
              {e.name}
            </button>
          ))}
        </div>

        {error && <ErrorState message={error} onRetry={load} />}
        {busy && !error && <Loading />}

        {!busy && !error && secrets.length === 0 && (
          <div className="panel">
            <div className="empty" style={{ padding: '56px 18px' }}>
              <h2 style={{ margin: '0 0 6px', fontSize: 16, color: 'var(--text)' }}>No secrets in {env}</h2>
              <p style={{ margin: '0 0 16px' }}>
                {canWrite
                  ? 'Add a secret or paste your existing .env file to import.'
                  : 'Ask a project admin or writer to add secrets.'}
              </p>
              {canWrite && (
                <button className="btn btn-primary" onClick={() => setShowAdd(true)}>
                  <Icon name="plus" size={14} strokeWidth={2.2} />
                  Add secret
                </button>
              )}
            </div>
          </div>
        )}

        {!busy && !error && secrets.length > 0 && (
          <div className="panel table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th style={{ width: '28%' }}>Key</th>
                  <th>Value</th>
                  <th style={{ width: 70 }}>Version</th>
                  <th style={{ width: 120 }}>Updated</th>
                  <th style={{ width: 170 }} />
                </tr>
              </thead>
              <tbody>
                {secrets.map((s) => (
                  <tr key={s.id}>
                    <td className="mono" style={{ color: 'var(--accent-soft)' }}>
                      {s.key}
                    </td>
                    <td>
                      {revealed[s.key] !== undefined ? (
                        <span className="mono" style={{ color: 'var(--text)' }}>
                          {revealed[s.key]}
                        </span>
                      ) : (
                        <span className="muted mono">••••••••••••</span>
                      )}
                    </td>
                    <td className="muted">v{s.version}</td>
                    <td className="muted">{new Date(s.updatedAt).toLocaleDateString()}</td>
                    <td style={{ textAlign: 'right' }}>
                      {revealed[s.key] === undefined ? (
                        <button className="btn btn-sm" onClick={() => reveal(s.key)}>
                          <Icon name="eye" size={13} /> Reveal
                        </button>
                      ) : (
                        <button
                          className="btn btn-sm"
                          onClick={() =>
                            setRevealed((r) => {
                              const next = { ...r };
                              delete next[s.key];
                              return next;
                            })
                          }
                        >
                          <Icon name="eyeOff" size={13} /> Hide
                        </button>
                      )}
                      {canAdmin && (
                        <button
                          className="btn btn-danger btn-sm"
                          style={{ marginLeft: 6 }}
                          onClick={() => removeSecret(s.key)}
                        >
                          <Icon name="trash" size={13} />
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {showAdd && (
        <Modal
          title={`Add secret to ${env}`}
          onClose={() => setShowAdd(false)}
          footer={
            <>
              <button className="btn" onClick={() => setShowAdd(false)}>
                Cancel
              </button>
              <button className="btn btn-primary" onClick={addSecret} disabled={!newKey.trim() || !newValue}>
                Save secret
              </button>
            </>
          }
        >
          <div className="field">
            <label className="field-label">Key</label>
            <input
              className="input mono"
              placeholder="STRIPE_SECRET_KEY"
              value={newKey}
              onChange={(e) => setNewKey(e.target.value)}
              autoFocus
            />
          </div>
          <div className="field">
            <label className="field-label">Value</label>
            <textarea
              className="textarea mono"
              placeholder="sk_live_..."
              value={newValue}
              onChange={(e) => setNewValue(e.target.value)}
              rows={3}
            />
            <span className="field-help">Every write creates a new immutable version — you can roll back later.</span>
          </div>
        </Modal>
      )}

      {showImport && (
        <Modal
          title={`Import .env into ${env}`}
          onClose={() => setShowImport(false)}
          footer={
            <>
              <button className="btn" onClick={() => setShowImport(false)}>
                Cancel
              </button>
              <button className="btn btn-primary" onClick={doImport} disabled={!importContent.trim()}>
                Import
              </button>
            </>
          }
        >
          <div className="field">
            <label className="field-label">.env content</label>
            <textarea
              className="textarea mono"
              placeholder={'DATABASE_URL=postgres://...\nAPI_KEY=sk_live_...\n# comments are skipped'}
              value={importContent}
              onChange={(e) => setImportContent(e.target.value)}
              rows={10}
              autoFocus
            />
            <span className="field-help">
              Paste your existing .env content. Existing keys are updated; new keys are created.
            </span>
          </div>
        </Modal>
      )}
    </ProjectShell>
  );
}
