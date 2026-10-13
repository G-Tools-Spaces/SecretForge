'use client';

import { useCallback, useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { api, Project, SecretRow } from '@/lib/api';
import { envLabel } from '@/lib/format';
import { useUser } from '@/lib/useUser';
import { ProjectShell } from '@/components/shell/AppShell';
import { Icon } from '@/components/Icon';
import { PageHeader, ErrorState } from '@/components/ui';
import { useToast } from '@/components/Toast';

interface VersionRow {
  version: number;
  changedById: string | null;
  changedAt: string;
}

/**
 * Version history: pick a secret, see every version, roll back (ADMIN).
 * Rollback copies an old version forward — history stays append-only.
 */
export default function VersionsPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const router = useRouter();
  const { user, loading } = useUser();
  const toast = useToast();

  const [project, setProject] = useState<Project | null>(null);
  const [env, setEnv] = useState('dev');
  const [secrets, setSecrets] = useState<SecretRow[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [versions, setVersions] = useState<VersionRow[]>([]);
  const [currentVersion, setCurrentVersion] = useState(0);
  const [busy, setBusy] = useState(true);
  const [busyVersions, setBusyVersions] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, env]);

  useEffect(() => {
    if (user) load();
  }, [user, load]);

  const loadVersions = useCallback(
    async (key: string) => {
      setBusyVersions(true);
      try {
        const v = await api<{ currentVersion: number; versions: VersionRow[] }>(
          `/projects/${projectId}/envs/${env}/secrets/${key}/versions`,
        );
        setVersions(v.versions);
        setCurrentVersion(v.currentVersion);
      } catch (err) {
        toast.show(err instanceof Error ? err.message : 'Failed to load versions', 'error');
      } finally {
        setBusyVersions(false);
      }
    },
    [projectId, env, toast],
  );

  useEffect(() => {
    if (selected) loadVersions(selected);
  }, [selected, loadVersions]);

  const isAdmin = project?.yourRole === 'ADMIN';

  const rollback = async (key: string, version: number) => {
    if (!confirm(`Roll back ${key} to v${version}? A new version with the old value will be created.`)) return;
    try {
      const res = await api<{ version: number }>(
        `/projects/${projectId}/envs/${env}/secrets/${key}/versions/${version}/rollback`,
        { method: 'POST' },
      );
      toast.show(`Rolled back ${key} to v${version} (now v${res.version})`);
      loadVersions(key);
      load();
    } catch (err) {
      toast.show(err instanceof Error ? err.message : 'Rollback failed', 'error');
    }
  };

  /** Resolve a user id to a display name via the project's member list. */
  const who = (userId: string | null): string => {
    if (!userId) return 'system';
    const m = project?.members?.find((m) => m.userId === userId);
    return m?.user.name || m?.user.email || 'unknown';
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
          title="Versions"
          description="Every secret change is versioned. Roll back to any previous version — history stays append-only."
        />

        <div className="segmented" style={{ marginBottom: 14 }}>
          {project.environments.map((e) => (
            <button
              key={e.id}
              aria-pressed={env === e.name}
              onClick={() => {
                setEnv(e.name);
                setSelected(null);
                setVersions([]);
              }}
            >
              {envLabel(e.name)}
            </button>
          ))}
        </div>

        {error && <ErrorState message={error} onRetry={load} />}

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1.4fr)',
            gap: 14,
            alignItems: 'start',
          }}
        >
          {/* Secret keys */}
          <section className="panel">
            <div className="panel-header">
              <h2>Secrets in {envLabel(env)}</h2>
              <span className="hint" style={{ marginLeft: 'auto' }}>
                {secrets.length}
              </span>
            </div>
            <div>
              {secrets.length === 0 && <div className="empty">No secrets in {envLabel(env)} yet.</div>}
              {secrets.map((s) => (
                <div
                  key={s.id}
                  className="row"
                  onClick={() => setSelected(s.key)}
                  style={{
                    alignItems: 'center',
                    gap: 10,
                    cursor: 'pointer',
                    background: selected === s.key ? 'var(--surface-hover)' : undefined,
                    borderLeft:
                      selected === s.key ? '2px solid var(--accent)' : '2px solid transparent',
                  }}
                >
                  <span
                    className="mono"
                    style={{
                      flex: 1,
                      minWidth: 0,
                      fontSize: 13,
                      color: selected === s.key ? 'var(--accent-soft)' : 'var(--text-2)',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {s.key}
                  </span>
                  <span className="muted" style={{ fontSize: 12, flex: '0 0 auto' }}>
                    v{s.version}
                  </span>
                </div>
              ))}
            </div>
          </section>

          {/* Version timeline for the selected key */}
          <section className="panel">
            <div className="panel-header">
              <h2>{selected ? `History — ${selected}` : 'History'}</h2>
              {selected && (
                <span className="hint" style={{ marginLeft: 'auto' }}>
                  current: v{currentVersion}
                </span>
              )}
            </div>
            <div>
              {!selected && <div className="empty">Select a secret to see its version history.</div>}
              {selected && busyVersions && (
                <div className="empty" style={{ display: 'flex', justifyContent: 'center' }}>
                  <span className="spinner" />
                </div>
              )}
              {selected &&
                !busyVersions &&
                versions.map((v) => (
                  <div className="row" key={v.version} style={{ alignItems: 'center', gap: 12 }}>
                    <span
                      className="mono"
                      style={{ width: 44, flex: '0 0 auto', fontSize: 13, color: 'var(--accent-soft)' }}
                    >
                      v{v.version}
                    </span>
                    <span style={{ flex: 1, minWidth: 0, fontSize: 13 }}>
                      <strong style={{ fontWeight: 600, color: 'var(--text)' }}>{who(v.changedById)}</strong>{' '}
                      <span style={{ color: 'var(--text-4)', fontSize: 12 }}>
                        {new Date(v.changedAt).toLocaleString()}
                      </span>
                    </span>
                    {v.version === currentVersion ? (
                      <span className="badge badge-ok">current</span>
                    ) : (
                      isAdmin && (
                        <button className="btn btn-sm" onClick={() => rollback(selected, v.version)}>
                          <Icon name="refresh" size={13} strokeWidth={2.2} />
                          Roll back
                        </button>
                      )
                    )}
                  </div>
                ))}
            </div>
          </section>
        </div>

        {!isAdmin && (
          <div className="notice" style={{ marginTop: 14 }}>
            Only project admins can roll back versions.
          </div>
        )}
      </div>
    </ProjectShell>
  );
}
