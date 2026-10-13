'use client';

import { useCallback, useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { api, AuditEntry, Project } from '@/lib/api';
import { useUser } from '@/lib/useUser';
import { AppShell, ProjectSidebar } from '@/components/AppShell';

const ACTION_LABELS: Record<string, string> = {
  USER_SIGNUP: 'signed up',
  USER_LOGIN: 'logged in',
  USER_LOGIN_FAILED: 'failed login',
  USER_LOGOUT: 'logged out',
  ORG_CREATED: 'created org',
  ORG_INVITE_CREATED: 'invited member',
  ORG_INVITE_REVOKED: 'revoked invite',
  ORG_MEMBER_JOINED: 'joined org',
  ORG_MEMBER_ROLE_CHANGED: 'changed org role',
  ORG_MEMBER_REMOVED: 'removed org member',
  PROJECT_CREATED: 'created project',
  PROJECT_MEMBER_ADDED: 'added member',
  PROJECT_MEMBER_ROLE_CHANGED: 'changed role',
  PROJECT_MEMBER_REMOVED: 'removed member',
  SECRET_CREATED: 'created secret',
  SECRET_UPDATED: 'updated secret',
  SECRET_DELETED: 'deleted secret',
  SECRET_REVEALED: 'revealed secret',
  SECRET_READ: 'exported secrets',
  SECRET_READ_DENIED: 'denied secret read',
  ACCESS_DENIED: 'access denied',
  SECRET_VERSION_ROLLED_BACK: 'rolled back version',
  TOKEN_CREATED: 'created token',
  TOKEN_REVOKED: 'revoked token',
};

export default function AuditPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const router = useRouter();
  const { user, loading } = useUser();

  const [project, setProject] = useState<Project | null>(null);
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [actionFilter, setActionFilter] = useState('');
  const [offset, setOffset] = useState(0);
  const [busy, setBusy] = useState(true);
  const LIMIT = 50;

  useEffect(() => {
    if (!loading && !user) router.push('/login');
  }, [loading, user, router]);

  const load = useCallback(async () => {
    if (!projectId) return;
    setBusy(true);
    try {
      const [p, a] = await Promise.all([
        api<Project>(`/projects/${projectId}`),
        api<{ entries: AuditEntry[]; total: number }>(
          `/audit?project=${projectId}&limit=${LIMIT}&offset=${offset}` +
            (actionFilter ? `&action=${actionFilter}` : ''),
        ),
      ]);
      setProject(p);
      setEntries(a.entries);
      setTotal(a.total);
    } catch {
      /* handled by empty state */
    } finally {
      setBusy(false);
    }
  }, [projectId, offset, actionFilter]);

  useEffect(() => {
    if (user) load();
  }, [user, load]);

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
      sidebar={<ProjectSidebar projectId={projectId} active="audit" />}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 }}>
        <div>
          <p style={{ fontSize: 20, fontWeight: 500, margin: 0 }}>Audit log</p>
          <p className="muted" style={{ margin: '4px 0 0', fontSize: 12.5 }}>
            {total} events — every read, write, and access attempt is recorded
          </p>
        </div>
        <select
          className="input"
          style={{ width: 200 }}
          value={actionFilter}
          onChange={(e) => {
            setActionFilter(e.target.value);
            setOffset(0);
          }}
        >
          <option value="">All actions</option>
          {Object.entries(ACTION_LABELS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </div>

      {busy ? (
        <div style={{ display: 'flex', justifyContent: 'center', padding: 40 }}>
          <span className="spinner" />
        </div>
      ) : entries.length === 0 ? (
        <div className="card" style={{ padding: 40, textAlign: 'center' }}>
          <p className="muted">No audit events match the current filter.</p>
        </div>
      ) : (
        <div className="card" style={{ overflow: 'hidden' }}>
          <table className="data">
            <thead>
              <tr>
                <th style={{ width: 150 }}>When</th>
                <th style={{ width: 220 }}>Actor</th>
                <th style={{ width: 170 }}>Action</th>
                <th>Resource</th>
                <th style={{ width: 130 }}>IP</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((e) => {
                const meta = (e.meta ?? {}) as Record<string, string>;
                const actorName = e.user?.name || e.user?.email || 'system';
                const initials = actorName.slice(0, 2).toUpperCase();
                const isDenied = e.action === 'ACCESS_DENIED' || e.action === 'USER_LOGIN_FAILED';
                return (
                  <tr key={e.id}>
                    <td className="muted">{new Date(e.createdAt).toLocaleString()}</td>
                    <td>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <div
                          style={{
                            width: 22,
                            height: 22,
                            borderRadius: '50%',
                            background: isDenied ? 'rgba(245,158,11,.2)' : 'var(--ac-25)',
                            color: isDenied ? 'var(--am)' : 'var(--al)',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            fontSize: 10,
                            fontWeight: 500,
                          }}
                        >
                          {isDenied ? '!' : initials}
                        </div>
                        <span>{actorName}</span>
                      </div>
                    </td>
                    <td>
                      <span style={{ color: isDenied ? 'var(--am)' : 'var(--tx)' }}>
                        {ACTION_LABELS[e.action] ?? e.action}
                      </span>
                      {meta.reason && (
                        <span className="muted" style={{ fontSize: 11 }}>
                          {' '}
                          ({meta.reason})
                        </span>
                      )}
                    </td>
                    <td className="mono muted" style={{ fontSize: 11 }}>
                      {e.resource}
                    </td>
                    <td className="mono muted" style={{ fontSize: 11 }}>
                      {e.ip ?? '—'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <div style={{ display: 'flex', gap: 8, justifyContent: 'center', marginTop: 14 }}>
        <button className="btn" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - LIMIT))}>
          <i className="ti ti-chevron-left" /> Newer
        </button>
        <span className="muted" style={{ alignSelf: 'center', fontSize: 12 }}>
          {offset + 1}–{Math.min(offset + LIMIT, total)} of {total}
        </span>
        <button
          className="btn"
          disabled={offset + LIMIT >= total}
          onClick={() => setOffset(offset + LIMIT)}
        >
          Older <i className="ti ti-chevron-right" />
        </button>
      </div>
    </AppShell>
  );
}
