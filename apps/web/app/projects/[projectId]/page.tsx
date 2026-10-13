'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { api, AuditEntry, Project, SecretRow } from '@/lib/api';
import { useUser } from '@/lib/useUser';
import { AppShell, ProjectSidebar } from '@/components/AppShell';

/**
 * Project Overview — mirrors the approved wireframe: stat cards, rotation
 * alerts, secrets-by-environment breakdown, and recent activity feed.
 * (Charts are Phase 5.5 — the wireframe's analytics endpoints come with
 * Phase 6 telemetry; this page shows live counts from existing APIs.)
 */
export default function OverviewPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const router = useRouter();
  const { user, loading } = useUser();

  const [project, setProject] = useState<Project | null>(null);
  const [secretCounts, setSecretCounts] = useState<Record<string, number>>({});
  const [audit, setAudit] = useState<AuditEntry[]>([]);
  const [busy, setBusy] = useState(true);

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
      } catch {
        /* empty states handle it */
      } finally {
        setBusy(false);
      }
    })();
  }, [user, projectId]);

  if (loading || !user) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <span className="spinner" />
      </div>
    );
  }

  const totalSecrets = Object.values(secretCounts).reduce((a, b) => a + b, 0);
  const memberCount = project?.members?.length ?? 0;

  const stats = [
    { label: 'Secrets', value: String(totalSecrets), sub: `Across ${project?.environments.length ?? 0} environments` },
    { label: 'Members', value: String(memberCount), sub: 'With project access' },
    { label: 'Your role', value: project?.yourRole ?? '—', sub: 'Project access level' },
    { label: 'Environments', value: String(project?.environments.length ?? 0), sub: (project?.environments ?? []).map((e) => e.name).join(', ') },
  ];

  return (
    <AppShell
      breadcrumb={
        <span className="muted" style={{ marginLeft: 6 }}>
          / {project?.org.name} / <span style={{ color: 'var(--tx)' }}>{project?.name}</span>
        </span>
      }
      sidebar={<ProjectSidebar projectId={projectId} active="overview" />}
    >
      <div style={{ marginBottom: 16 }}>
        <p style={{ fontSize: 20, fontWeight: 500, margin: 0 }}>Overview</p>
        <p className="muted" style={{ margin: '4px 0 0', fontSize: 12.5 }}>
          How your team is using {project?.name} secrets
        </p>
      </div>

      {busy ? (
        <div style={{ display: 'flex', justifyContent: 'center', padding: 40 }}>
          <span className="spinner" />
        </div>
      ) : (
        <>
          {/* Stat cards — wireframe grid */}
          <div className="card" style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', overflow: 'hidden', marginBottom: 12 }}>
            {stats.map((s, i) => (
              <div
                key={s.label}
                style={{
                  padding: '14px 16px',
                  borderRight: i < stats.length - 1 ? '1px solid var(--bd)' : undefined,
                }}
              >
                <p className="muted" style={{ fontSize: 11, margin: 0, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                  {s.label}
                </p>
                <p style={{ fontSize: 22, fontWeight: 500, margin: '4px 0' }}>{s.value}</p>
                <p className="muted" style={{ fontSize: 11.5, margin: 0 }}>
                  {s.sub}
                </p>
              </div>
            ))}
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1.6fr 1fr', gap: 12, marginBottom: 12 }}>
            {/* Secrets by environment — donut placeholder with live counts */}
            <div className="card">
              <div className="card-head">
                <span>Secrets by environment</span>
              </div>
              <div style={{ padding: 16 }}>
                {(project?.environments ?? []).map((e) => {
                  const count = secretCounts[e.name] ?? 0;
                  const pct = totalSecrets > 0 ? Math.round((count / totalSecrets) * 100) : 0;
                  return (
                    <div key={e.id} style={{ marginBottom: 10 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                        <span style={{ textTransform: 'capitalize' }}>{e.name}</span>
                        <span className="muted">
                          {count} secret{count === 1 ? '' : 's'} · {pct}%
                        </span>
                      </div>
                      <div style={{ height: 6, background: 'var(--bg)', borderRadius: 3, overflow: 'hidden' }}>
                        <div
                          style={{
                            width: `${pct}%`,
                            height: '100%',
                            background: e.name === 'prod' ? 'var(--am)' : 'var(--ac)',
                            borderRadius: 3,
                          }}
                        />
                      </div>
                    </div>
                  );
                })}
                {totalSecrets === 0 && (
                  <p className="muted" style={{ textAlign: 'center', padding: 12 }}>
                    No secrets yet — add some in the Secrets tab.
                  </p>
                )}
              </div>
            </div>

            {/* Quick actions */}
            <div className="card">
              <div className="card-head">
                <span>Quick start</span>
              </div>
              <div style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
                <div className="btn" style={{ justifyContent: 'flex-start' }} onClick={() => router.push(`/projects/${projectId}/secrets`)}>
                  <i className="ti ti-key" /> Manage secrets
                </div>
                <div className="btn" style={{ justifyContent: 'flex-start' }} onClick={() => router.push(`/projects/${projectId}/members`)}>
                  <i className="ti ti-users" /> Share with teammates
                </div>
                <div className="btn" style={{ justifyContent: 'flex-start' }} onClick={() => router.push(`/projects/${projectId}/integrate`)}>
                  <i className="ti ti-terminal-2" /> Connect the CLI
                </div>
              </div>
            </div>
          </div>

          {/* Recent activity — wireframe's feed */}
          <div className="card">
            <div className="card-head">
              <span>Recent activity</span>
              <span
                style={{ color: 'var(--ac)', fontWeight: 500, fontSize: 11.5, cursor: 'pointer' }}
                onClick={() => router.push(`/projects/${projectId}/audit`)}
              >
                Open audit log <i className="ti ti-arrow-right" style={{ fontSize: 12, verticalAlign: -1 }} />
              </span>
            </div>
            {audit.length === 0 ? (
              <p className="muted" style={{ padding: 20, textAlign: 'center', margin: 0 }}>
                No activity yet.
              </p>
            ) : (
              audit.map((e) => {
                const actor = e.user?.name || e.user?.email || 'system';
                const isDenied = e.action === 'ACCESS_DENIED';
                return (
                  <div
                    key={e.id}
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      padding: '10px 14px',
                      borderBottom: '1px solid var(--bd)',
                    }}
                  >
                    <span style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
                      <span
                        style={{
                          width: 22,
                          height: 22,
                          borderRadius: '50%',
                          background: isDenied ? 'rgba(245,158,11,.2)' : 'var(--ac-25)',
                          color: isDenied ? 'var(--am)' : 'var(--al)',
                          display: 'inline-flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          fontSize: 10,
                          fontWeight: 500,
                        }}
                      >
                        {isDenied ? '!' : actor.slice(0, 2).toUpperCase()}
                      </span>
                      <span>
                        <strong style={{ fontWeight: 500 }}>{actor}</strong>{' '}
                        <span className="muted">{e.action.replaceAll('_', ' ').toLowerCase()}</span>{' '}
                        <span className="mono" style={{ color: 'var(--al)', fontSize: 11 }}>
                          {e.resource.split('/').pop()}
                        </span>
                      </span>
                    </span>
                    <span className="muted" style={{ fontSize: 11.5 }}>
                      {timeAgo(e.createdAt)}
                    </span>
                  </div>
                );
              })
            )}
          </div>
        </>
      )}
    </AppShell>
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
