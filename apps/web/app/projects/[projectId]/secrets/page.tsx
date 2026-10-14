'use client';

import { useCallback, useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { api, groupQuery, Project, SecretRow } from '@/lib/api';
import { envLabel } from '@/lib/format';
import { useUser } from '@/lib/useUser';
import { ProjectShell } from '@/components/shell/AppShell';
import { Icon } from '@/components/Icon';
import { PageHeader, Loading, ErrorState, Modal } from '@/components/ui';
import { useToast } from '@/components/Toast';
import { useConfirm } from '@/components/Confirm';

const GROUP_RE = /^[a-z0-9][a-z0-9-]{0,29}$/;
const ALL = '*'; // sentinel: show every group

export default function SecretsPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const router = useRouter();
  const { user, loading } = useUser();
  const toast = useToast();
  const confirm = useConfirm();

  const [project, setProject] = useState<Project | null>(null);
  const [env, setEnv] = useState('dev');
  const [secrets, setSecrets] = useState<SecretRow[]>([]);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [revealed, setRevealed] = useState<Record<string, string>>({});
  const [showAdd, setShowAdd] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [group, setGroup] = useState<string>(ALL); // ALL | '' (ungrouped) | group name
  const [extraGroups, setExtraGroups] = useState<string[]>([]); // created in UI, no secrets yet
  const [newGroup, setNewGroup] = useState('');
  const [showGroup, setShowGroup] = useState(false);
  const [groupDraft, setGroupDraft] = useState('');
  const [importGroup, setImportGroup] = useState('');
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

  const named = Array.from(new Set([...secrets.map((s) => s.group), ...extraGroups]))
    .filter((g) => g !== '')
    .sort();
  const hasUngrouped = secrets.some((s) => s.group === '');
  // Default view (no group selected) shows ungrouped secrets; clicking a group shows only that group.
  const visible = group === ALL ? secrets.filter((s) => s.group === '') : secrets.filter((s) => s.group === group);
  const idOf = (s: SecretRow) => s.id;

  const checkGroup = (g: string): boolean => {
    if (g !== '' && !GROUP_RE.test(g)) {
      toast.show('Group names: lowercase letters, digits and dashes (max 30)', 'error');
      return false;
    }
    return true;
  };
  const groupTag = (g: string) => (g ? ` / ${g}` : '');

  const reveal = async (s: SecretRow) => {
    const id = idOf(s);
    try {
      const res = await api<{ value: string }>(
        `/projects/${projectId}/envs/${env}/secrets/${s.key}${groupQuery(s.group)}`,
      );
      setRevealed((r) => ({ ...r, [id]: res.value }));
      setTimeout(() => {
        setRevealed((r) => {
          const next = { ...r };
          delete next[id];
          return next;
        });
      }, 30_000);
    } catch (err) {
      toast.show(err instanceof Error ? err.message : 'Failed to reveal', 'error');
    }
  };

  const addSecret = async () => {
    if (!newKey.trim() || !newValue) return;
    const g = newGroup.trim();
    if (!checkGroup(g)) return;
    try {
      await api(`/projects/${projectId}/envs/${env}/secrets/${newKey.trim()}${groupQuery(g)}`, {
        method: 'PUT',
        body: JSON.stringify({ value: newValue }),
      });
      toast.show(`Set ${newKey.trim()} in ${env}${groupTag(g)}`);
      setShowAdd(false);
      setNewKey('');
      setNewValue('');
      load();
    } catch (err) {
      toast.show(err instanceof Error ? err.message : 'Failed', 'error');
    }
  };

  const removeSecret = async (s: SecretRow) => {
    const label = s.group ? `${s.group}/${s.key}` : s.key;
    const ok = await confirm({
      title: 'Delete secret',
      message: `Delete secret ${label} and its entire version history? This cannot be undone.`,
      confirmLabel: 'Delete',
      danger: true,
    });
    if (!ok) return;
    try {
      await api(`/projects/${projectId}/envs/${env}/secrets/${s.key}${groupQuery(s.group)}`, {
        method: 'DELETE',
      });
      toast.show(`Deleted ${label}`);
      load();
    } catch (err) {
      toast.show(err instanceof Error ? err.message : 'Failed', 'error');
    }
  };

  const doImport = async () => {
    const g = importGroup.trim();
    if (!checkGroup(g)) return;
    try {
      const res = await api<{ imported: number; created: number; updated: number }>(
        `/projects/${projectId}/envs/${env}/secrets/import${groupQuery(g)}`,
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

  const createGroup = () => {
    const g = groupDraft.trim();
    if (!g || !checkGroup(g)) return;
    setExtraGroups((x) => (x.includes(g) ? x : [...x, g]));
    setGroup(g);
    setShowGroup(false);
  };

  const openAdd = () => {
    // Inside a group → prefill that group; default view → ungrouped.
    setNewGroup(group === ALL ? '' : group);
    setShowAdd(true);
  };

  const exportEnv = async () => {
    try {
      // One .env block per group in view; headers only when several groups.
      const groups = group === ALL ? [...(hasUngrouped ? [''] : []), ...named.filter((g) => secrets.some((s) => s.group === g))] : [group];
      const blocks: string[] = [];
      let total = 0;
      for (const g of groups) {
        const res = await api<{ values: Record<string, string> }>(
          `/projects/${projectId}/envs/${env}/secrets/export${groupQuery(g)}`,
        );
        const lines = Object.entries(res.values)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([k, v]) => `${k}=${v}`);
        total += lines.length;
        blocks.push(groups.length > 1 ? `# --- ${g || 'ungrouped'} ---\n${lines.join('\n')}` : lines.join('\n'));
      }
      await navigator.clipboard.writeText(blocks.join('\n\n'));
      toast.show(`Copied ${total} secrets to clipboard`);
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
                  <button className="btn" onClick={() => {
                      setImportGroup(group === ALL ? '' : group);
                      setShowImport(true);
                    }}>
                    <Icon name="upload" size={14} strokeWidth={2.2} />
                    Import .env
                  </button>
                  <button className="btn btn-primary" onClick={openAdd}>
                    <Icon name="plus" size={14} strokeWidth={2.2} />
                    Add secret
                  </button>
                </>
              )}
            </>
          }
        />

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
          <div className="segmented">
            {project.environments.map((e) => (
              <button
                key={e.id}
                aria-pressed={env === e.name}
                onClick={() => {
                  setEnv(e.name);
                  setGroup(ALL);
                  setExtraGroups([]);
                  setRevealed({});
                }}
              >
                {envLabel(e.name)}
              </button>
            ))}
          </div>
          {canWrite && (
            <button
              className="btn"
              onClick={() => {
                setGroupDraft('');
                setShowGroup(true);
              }}
            >
              <Icon name="plus" size={14} strokeWidth={2.2} />
              Create group
            </button>
          )}
        </div>

        {named.length > 0 && (
          <div className="segmented" style={{ marginTop: 8 }} aria-label="Groups">
            {named.map((g) => (
              <button key={g} aria-pressed={group === g} onClick={() => setGroup(g)}>
                {g}
              </button>
            ))}
          </div>
        )}

        {group !== ALL && (
          <div style={{ marginTop: 8 }}>
            <button className="btn btn-sm" onClick={() => setGroup(ALL)}>
              ← Back to ungrouped
            </button>
          </div>
        )}

        {error && <ErrorState message={error} onRetry={load} />}
        {busy && !error && <Loading />}

        {!busy && !error && visible.length === 0 && (
          <div className="panel">
            <div className="empty" style={{ padding: '56px 18px' }}>
              <h2 style={{ margin: '0 0 6px', fontSize: 16, color: 'var(--text)' }}>
                {group !== ALL ? `No secrets in ${group}` : `No secrets in ${envLabel(env)}`}
              </h2>
              <p style={{ margin: '0 0 16px' }}>
                {canWrite
                  ? group !== ALL
                    ? `Add a secret to the ${group} group.`
                    : 'Add a secret or paste your existing .env file to import.'
                  : 'Ask a project admin or writer to add secrets.'}
              </p>
              {canWrite && (
                <button className="btn btn-primary" onClick={openAdd}>
                  <Icon name="plus" size={14} strokeWidth={2.2} />
                  Add secret
                </button>
              )}
            </div>
          </div>
        )}

        {!busy && !error && visible.length > 0 && (
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
                {visible.map((s) => (
                  <tr key={s.id}>
                    <td className="mono" style={{ color: 'var(--accent-soft)' }}>
                      {s.key}
                    </td>
                    <td>
                      {revealed[idOf(s)] !== undefined ? (
                        <span className="mono" style={{ color: 'var(--text)' }}>
                          {revealed[idOf(s)]}
                        </span>
                      ) : (
                        <span className="muted mono">••••••••••••</span>
                      )}
                    </td>
                    <td className="muted">v{s.version}</td>
                    <td className="muted">{new Date(s.updatedAt).toLocaleDateString()}</td>
                    <td style={{ textAlign: 'right' }}>
                      {revealed[idOf(s)] === undefined ? (
                        <button className="btn btn-sm" onClick={() => reveal(s)}>
                          <Icon name="eye" size={13} /> Reveal
                        </button>
                      ) : (
                        <button
                          className="btn btn-sm"
                          onClick={() =>
                            setRevealed((r) => {
                              const next = { ...r };
                              delete next[idOf(s)];
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
                          onClick={() => removeSecret(s)}
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

      {showGroup && (
        <Modal
          title="New group"
          onClose={() => setShowGroup(false)}
          footer={
            <>
              <button className="btn" onClick={() => setShowGroup(false)}>
                Cancel
              </button>
              <button className="btn btn-primary" onClick={createGroup} disabled={!groupDraft.trim()}>
                Create group
              </button>
            </>
          }
        >
          <div className="field">
            <label className="field-label">Group name</label>
            <input
              className="input mono"
              placeholder="frontend"
              value={groupDraft}
              onChange={(e) => setGroupDraft(e.target.value.toLowerCase())}
              onKeyDown={(e) => e.key === 'Enter' && createGroup()}
              autoFocus
            />
            <span className="field-help">
              Lowercase letters, digits and dashes (e.g. frontend, backend). The group appears once you add a secret to it.
            </span>
          </div>
        </Modal>
      )}

      {showAdd && (
        <Modal
          title={`Add secret to ${envLabel(env)}${groupTag(newGroup.trim())}`}
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
            <label className="field-label">Group (optional)</label>
            <input
              className="input mono"
              placeholder="backend"
              list="secret-groups"
              value={newGroup}
              onChange={(e) => setNewGroup(e.target.value)}
            />
            <datalist id="secret-groups">
              {named.map((g) => (
                <option key={g} value={g} />
              ))}
            </datalist>
          </div>
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
          title={`Import .env into ${envLabel(env)}${groupTag(importGroup.trim())}`}
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
            <label className="field-label">Group (optional)</label>
            <input
              className="input mono"
              placeholder="backend"
              list="secret-groups"
              value={importGroup}
              onChange={(e) => setImportGroup(e.target.value)}
            />
            <datalist id="secret-groups">
              {named.map((g) => (
                <option key={g} value={g} />
              ))}
            </datalist>
            <span className="field-help">
              Import one .env per group, e.g. frontend/.env into “frontend”, backend/.env into “backend”.
            </span>
          </div>
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
