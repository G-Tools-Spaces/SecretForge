'use client';

import { useCallback, useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { api, Project, SecretRow } from '@/lib/api';
import { useUser } from '@/lib/useUser';
import { AppShell, ProjectSidebar } from '@/components/AppShell';
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
  const [revealed, setRevealed] = useState<Record<string, string>>({});
  const [showAdd, setShowAdd] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [newKey, setNewKey] = useState('');
  const [newValue, setNewValue] = useState('');
  const [importContent, setImportContent] = useState('');
  const [canWrite, setCanWrite] = useState(false);
  const [canAdmin, setCanAdmin] = useState(false);

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
      setCanWrite(p.yourRole === 'ADMIN' || p.yourRole === 'WRITE');
      setCanAdmin(p.yourRole === 'ADMIN');
      if (!p.environments.some((e) => e.name === env)) {
        setEnv(p.environments[0]?.name ?? 'dev');
      }
    } catch (err) {
      toast.show(err instanceof Error ? err.message : 'Failed to load', 'error');
    } finally {
      setBusy(false);
    }
  }, [projectId, env]);

  useEffect(() => {
    if (user) load();
  }, [user, load]);

  const reveal = async (key: string) => {
    try {
      const res = await api<{ value: string }>(
        `/projects/${projectId}/envs/${env}/secrets/${key}`,
      );
      setRevealed((r) => ({ ...r, [key]: res.value }));
      // Auto-hide after 30s — values shouldn't linger on screen.
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
      toast.show(
        `Imported ${res.imported} secrets (${res.created} created, ${res.updated} updated)`,
      );
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

  return (
    <AppShell
      breadcrumb={
        <span className="muted" style={{ marginLeft: 6 }}>
          / {project?.org.name} / <span style={{ color: 'var(--tx)' }}>{project?.name}</span>
        </span>
      }
      sidebar={<ProjectSidebar projectId={projectId} active="secrets" />}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 }}>
        <div>
          <p style={{ fontSize: 20, fontWeight: 500, margin: 0 }}>Secrets</p>
          <p className="muted" style={{ margin: '4px 0 0', fontSize: 12.5 }}>
            Values are encrypted at rest (AES-256-GCM) and only decrypted on reveal.
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn" onClick={exportEnv}>
            <i className="ti ti-copy" /> Copy all
          </button>
          {canWrite && (
            <>
              <button className="btn" onClick={() => setShowImport(true)}>
                <i className="ti ti-file-import" /> Import .env
              </button>
              <button className="btn primary" onClick={() => setShowAdd(true)}>
                <i className="ti ti-plus" /> Add secret
              </button>
            </>
          )}
        </div>
      </div>

      {/* Env tabs */}
      <div className="env-tabs" style={{ marginBottom: 14, display: 'inline-flex' }}>
        {(project?.environments ?? []).map((e) => (
          <span
            key={e.id}
            className={env === e.name ? 'active' : ''}
            onClick={() => {
              setEnv(e.name);
              setRevealed({});
            }}
          >
            {e.name}
          </span>
        ))}
      </div>

      {busy ? (
        <div style={{ display: 'flex', justifyContent: 'center', padding: 40 }}>
          <span className="spinner" />
        </div>
      ) : secrets.length === 0 ? (
        <div className="card" style={{ padding: 40, textAlign: 'center' }}>
          <i className="ti ti-key-off" style={{ fontSize: 32, color: 'var(--mu)' }} />
          <p style={{ marginTop: 12, fontWeight: 500 }}>No secrets in {env}</p>
          <p className="muted" style={{ fontSize: 12.5 }}>
            {canWrite
              ? 'Add a secret or paste your existing .env file to import.'
              : 'Ask a project admin or writer to add secrets.'}
          </p>
        </div>
      ) : (
        <div className="card" style={{ overflow: 'hidden' }}>
          <table className="data">
            <thead>
              <tr>
                <th style={{ width: '30%' }}>Key</th>
                <th>Value</th>
                <th style={{ width: 70 }}>Version</th>
                <th style={{ width: 130 }}>Updated</th>
                <th style={{ width: 150 }} />
              </tr>
            </thead>
            <tbody>
              {secrets.map((s) => (
                <tr key={s.id}>
                  <td className="mono" style={{ color: 'var(--al)' }}>{s.key}</td>
                  <td>
                    {revealed[s.key] !== undefined ? (
                      <span className="mono" style={{ color: 'var(--tx)' }}>
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
                      <button className="btn" style={{ padding: '3px 8px' }} onClick={() => reveal(s.key)}>
                        <i className="ti ti-eye" /> Reveal
                      </button>
                    ) : (
                      <button
                        className="btn"
                        style={{ padding: '3px 8px' }}
                        onClick={() =>
                          setRevealed((r) => {
                            const next = { ...r };
                            delete next[s.key];
                            return next;
                          })
                        }
                      >
                        <i className="ti ti-eye-off" /> Hide
                      </button>
                    )}
                    {canAdmin && (
                      <button
                        className="btn danger"
                        style={{ padding: '3px 8px', marginLeft: 6 }}
                        onClick={() => removeSecret(s.key)}
                      >
                        <i className="ti ti-trash" />
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Add secret modal */}
      {showAdd && (
        <Modal onClose={() => setShowAdd(false)} title={`Add secret to ${env}`}>
          <label className="muted" style={{ display: 'block', fontSize: 11.5, marginBottom: 5 }}>
            Key
          </label>
          <input
            className="input"
            placeholder="STRIPE_SECRET_KEY"
            value={newKey}
            onChange={(e) => setNewKey(e.target.value)}
            style={{ marginBottom: 12, fontFamily: 'var(--font-mono)' }}
          />
          <label className="muted" style={{ display: 'block', fontSize: 11.5, marginBottom: 5 }}>
            Value
          </label>
          <textarea
            className="input"
            placeholder="sk_live_..."
            value={newValue}
            onChange={(e) => setNewValue(e.target.value)}
            rows={3}
            style={{ marginBottom: 12, fontFamily: 'var(--font-mono)', resize: 'vertical' }}
          />
          <p className="muted" style={{ fontSize: 11.5, margin: '0 0 14px' }}>
            Every write creates a new immutable version — you can roll back later.
          </p>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <button className="btn" onClick={() => setShowAdd(false)}>
              Cancel
            </button>
            <button className="btn primary" onClick={addSecret}>
              Save secret
            </button>
          </div>
        </Modal>
      )}

      {/* Import modal */}
      {showImport && (
        <Modal onClose={() => setShowImport(false)} title={`Import .env into ${env}`}>
          <textarea
            className="input"
            placeholder={'DATABASE_URL=postgres://...\nAPI_KEY=sk_live_...\n# comments are skipped'}
            value={importContent}
            onChange={(e) => setImportContent(e.target.value)}
            rows={10}
            style={{ marginBottom: 12, fontFamily: 'var(--font-mono)', resize: 'vertical' }}
            autoFocus
          />
          <p className="muted" style={{ fontSize: 11.5, margin: '0 0 14px' }}>
            Paste your existing .env content. Existing keys are updated; new keys are created.
          </p>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <button className="btn" onClick={() => setShowImport(false)}>
              Cancel
            </button>
            <button className="btn primary" onClick={doImport}>
              Import
            </button>
          </div>
        </Modal>
      )}
    </AppShell>
  );
}

function Modal({
  children,
  onClose,
  title,
}: {
  children: React.ReactNode;
  onClose: () => void;
  title: string;
}) {
  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,.6)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 100,
      }}
      onClick={onClose}
    >
      <div
        className="card"
        style={{ width: 440, padding: 20 }}
        onClick={(e) => e.stopPropagation()}
      >
        <p style={{ fontWeight: 500, margin: '0 0 14px' }}>{title}</p>
        {children}
      </div>
    </div>
  );
}
