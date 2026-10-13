'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { api, AuditEntry, Project, SecretRow } from '@/lib/api';
import { envLabel } from '@/lib/format';
import { useUser } from '@/lib/useUser';
import { ProjectShell } from '@/components/shell/AppShell';
import { Icon } from '@/components/Icon';
import { PageHeader, ErrorState } from '@/components/ui';

/**
 * Project Overview — KPI cards, secrets-by-environment breakdown,
 * quick-start actions, and the recent activity feed.
 */
export default function OverviewPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const router = useRouter();
  const { user, loading } = useUser();

  const [project, setProject] = useState<Project | null>(null);
  const [secretCounts, setSecretCounts] = useState<Record<string, number>>({});
  const [audit, setAudit] = useState<AuditEntry[]>([]);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!loading && !user) router.push('/login');
  }, [loading, user, router]);

  useEffect(() => {
    if (!user || !projectId) return;
    (async () => {
      try {
        const p = await api<Project>(`/projects/${projectId}`);
        setProject(p);

        // Count secrets per environment (masked lists are cheap).
        const counts: Record<string, number> = {};
        await Promise.all(
          p.environments.map(async (e) => {
            const s = await api<{ secrets: SecretRow[] }>(
              `/projects/${projectId}/envs/${e.name}/secrets`,
            );
            counts[e.name] = s.secrets.length;
          }),
        );
        setSecretCounts(counts);

        const a = await api<{ entries: AuditEntry[] }>(`/audit?project=${projectId}&limit=8`);
        setAudit(a.entries);
        setError(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load');
      } finally {
        setBusy(false);
      }
    })();
  }, [user, projectId]);

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
        <ErrorState message={error ?? 'Project not found'} onRetry={() => window.location.reload()} />
      </div>
    );
  }

  const totalSecrets = Object.values(secretCounts).reduce((a, b) => a + b, 0);
  const memberCount = project.members?.length ?? 0;

  const stats = [
    { label: 'Secrets', value: String(totalSecrets), sub: `Across ${project.environments.length} environments` },
    { label: 'Members', value: String(memberCount), sub: 'With project access' },
    { label: 'Your role', value: project.yourRole ?? '—', sub: 'Project access level' },
    {
      label: 'Environments',
      value: String(project.environments.length),
      sub: project.environments.map((e) => e.name).join(', '),
    },
  ];

  return (
    <ProjectShell project={project}>
      <div className="page">
        <PageHeader title="Overview" description={`How your team is using ${project.name} secrets`} />

        {busy ? (
          <div className="empty" style={{ display: 'flex', justifyContent: 'center' }}>
            <span className="spinner" />
          </div>
        ) : (
          <>
            {/* KPI cards */}
            <div className="kpi-grid" style={{ marginBottom: 14 }}>
              {stats.map((s) => (
                <div className="kpi" key={s.label}>
                  <div className="kpi-label">{s.label}</div>
                  <div className="kpi-value-row">
                    <div className="kpi-value">{s.value}</div>
                  </div>
                  <div className="kpi-sub">{s.sub}</div>
                </div>
              ))}
            </div>

            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'minmax(0, 1.6fr) minmax(0, 1fr)',
                gap: 14,
                marginBottom: 14,
              }}
            >
              {/* Secrets by environment */}
              <section className="panel">
                <div className="panel-header">
                  <h2>Secrets by environment</h2>
                </div>
                <div className="panel-body">
                  {project.environments.map((e) => {
                    const count = secretCounts[e.name] ?? 0;
                    const pct = totalSecrets > 0 ? Math.round((count / totalSecrets) * 100) : 0;
                    return (
                      <div key={e.id} style={{ marginBottom: 12 }}>
                        <div
                          style={{
                            display: 'flex',
                            justifyContent: 'space-between',
                            marginBottom: 6,
                            fontSize: 13,
                          }}
                        >
                          <span style={{ color: 'var(--text-2)' }}>{envLabel(e.name)}</span>
                          <span style={{ color: 'var(--text-3)', fontSize: 12 }}>
                            {count} secret{count === 1 ? '' : 's'} · {pct}%
                          </span>
                        </div>
                        <div style={{ height: 6, background: 'var(--bg)', overflow: 'hidden' }}>
                          <div
                            style={{
                              width: `${pct}%`,
                              height: '100%',
                              background: e.name === 'prod' ? 'var(--warn)' : 'var(--accent)',
                            }}
                          />
                        </div>
                      </div>
                    );
                  })}
                  {totalSecrets === 0 && (
                    <div className="empty" style={{ padding: '18px 0' }}>
                      No secrets yet — add some in the Secrets tab.
                    </div>
                  )}
                </div>
              </section>

              {/* Quick start */}
              <section className="panel">
                <div className="panel-header">
                  <h2>Quick start</h2>
                </div>
                <div className="panel-body" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  <button
                    className="btn"
                    style={{ justifyContent: 'flex-start', width: '100%' }}
                    onClick={() => router.push(`/projects/${projectId}/secrets`)}
                  >
                    <Icon name="key" size={14} strokeWidth={2.2} />
                    Manage secrets
                  </button>
                  <button
                    className="btn"
                    style={{ justifyContent: 'flex-start', width: '100%' }}
                    onClick={() => router.push(`/projects/${projectId}/members`)}
                  >
                    <Icon name="members" size={14} strokeWidth={2.2} />
                    Share with teammates
                  </button>
                  <button
                    className="btn"
                    style={{ justifyContent: 'flex-start', width: '100%' }}
                    onClick={() => router.push(`/projects/${projectId}/integrate`)}
                  >
                    <Icon name="integrate" size={14} strokeWidth={2.2} />
                    Connect the CLI
                  </button>
                </div>
              </section>
            </div>

            {/* Recent activity */}
            <section className="panel">
              <div className="panel-header">
                <h2>Recent activity</h2>
                <button
                  className="btn btn-sm"
                  onClick={() => router.push(`/projects/${projectId}/audit`)}
                  style={{ marginLeft: 'auto' }}
                >
                  Open audit log
                  <Icon name="external" size={13} strokeWidth={2.2} />
                </button>
              </div>
              <div>
                {audit.length === 0 ? (
                  <div className="empty">No activity yet.</div>
                ) : (
                  audit.map((e) => {
                    const actor = e.user?.name || e.user?.email || 'system';
                    const isDenied = e.action === 'ACCESS_DENIED' || e.action === 'USER_LOGIN_FAILED';
                    return (
                      <div className="row" key={e.id} style={{ alignItems: 'center', gap: 12 }}>
                        <span
                          style={{
                            width: 26,
                            height: 26,
                            flex: '0 0 auto',
                            background: isDenied ? 'rgba(245,158,11,.12)' : 'var(--chip)',
                            border: `1px solid ${isDenied ? 'var(--warn-border)' : 'var(--border-strong)'}`,
                            color: isDenied ? 'var(--warn-soft)' : 'var(--accent-soft)',
                            display: 'inline-flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            fontSize: 10,
                            fontWeight: 600,
                          }}
                        >
                          {isDenied ? '!' : actor.slice(0, 2).toUpperCase()}
                        </span>
                        <span style={{ flex: 1, minWidth: 0, fontSize: 13 }}>
                          <strong style={{ fontWeight: 600, color: 'var(--text)' }}>{actor}</strong>{' '}
                          <span style={{ color: 'var(--text-3)' }}>
                            {e.action.replaceAll('_', ' ').toLowerCase()}
                          </span>{' '}
                          <span className="mono" style={{ color: 'var(--accent-soft)', fontSize: 12 }}>
                            {e.resource.split('/').pop()}
                          </span>
                        </span>
                        <span style={{ color: 'var(--text-4)', fontSize: 12, flex: '0 0 auto' }}>
                          {timeAgo(e.createdAt)}
                        </span>
                      </div>
                    );
                  })
                )}
              </div>
            </section>
          </>
        )}
      </div>
    </ProjectShell>
  );
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}
