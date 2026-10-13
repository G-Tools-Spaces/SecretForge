'use client';

import { useCallback, useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { api, Project } from '@/lib/api';
import { useUser } from '@/lib/useUser';
import { AppShell, ProjectSidebar } from '@/components/AppShell';
import { useToast } from '@/components/Toast';

interface Member {
  id: string;
  userId: string;
  role: 'ADMIN' | 'WRITE' | 'READ';
  user: { id: string; email: string; name: string | null };
}

interface ShareableMember {
  id: string;
  user: { id: string; email: string; name: string | null };
}

export default function MembersPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const router = useRouter();
  const { user, loading } = useUser();
  const toast = useToast();

  const [project, setProject] = useState<Project | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [busy, setBusy] = useState(true);
  const [showShare, setShowShare] = useState(false);
  const [shareable, setShareable] = useState<ShareableMember[]>([]);
  const [shareEmail, setShareEmail] = useState('');
  const [shareRole, setShareRole] = useState<'ADMIN' | 'WRITE' | 'READ'>('READ');
  const [isProjectAdmin, setIsProjectAdmin] = useState(false);

  useEffect(() => {
    if (!loading && !user) router.push('/login');
  }, [loading, user, router]);

  const load = useCallback(async () => {
    if (!projectId) return;
    setBusy(true);
    try {
      const p = await api<Project>(`/projects/${projectId}`);
      setProject(p);
      setMembers((p.members ?? []) as Member[]);
      setIsProjectAdmin(p.yourRole === 'ADMIN');
    } catch (err) {
      toast.show(err instanceof Error ? err.message : 'Failed to load', 'error');
    } finally {
      setBusy(false);
    }
  }, [projectId]);

  useEffect(() => {
    if (user) load();
  }, [user, load]);

  const openShare = async () => {
    try {
      const list = await api<ShareableMember[]>(`/projects/${projectId}/shareable-members`);
      setShareable(list);
      setShowShare(true);
    } catch (err) {
      toast.show(err instanceof Error ? err.message : 'Failed', 'error');
    }
  };

  const share = async () => {
    if (!shareEmail.trim()) return;
    try {
      await api(`/projects/${projectId}/members`, {
        method: 'POST',
        body: JSON.stringify({ email: shareEmail.trim(), role: shareRole }),
      });
      toast.show(`Shared with ${shareEmail.trim()} (${shareRole})`);
      setShowShare(false);
      setShareEmail('');
      load();
    } catch (err) {
      toast.show(err instanceof Error ? err.message : 'Failed', 'error');
    }
  };

  const changeRole = async (userId: string, role: string) => {
    try {
      await api(`/projects/${projectId}/members/${userId}/role`, {
        method: 'POST',
        body: JSON.stringify({ role }),
      });
      toast.show('Role updated');
      load();
    } catch (err) {
      toast.show(err instanceof Error ? err.message : 'Failed', 'error');
    }
  };

  const removeMember = async (userId: string, email: string) => {
    if (!confirm(`Remove ${email} from this project?`)) return;
    try {
      await api(`/projects/${projectId}/members/${userId}`, { method: 'DELETE' });
      toast.show(`Removed ${email}`);
      load();
    } catch (err) {
      toast.show(err instanceof Error ? err.message : 'Failed', 'error');
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
      sidebar={<ProjectSidebar projectId={projectId} active="members" />}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 }}>
        <div>
          <p style={{ fontSize: 20, fontWeight: 500, margin: 0 }}>Members</p>
          <p className="muted" style={{ margin: '4px 0 0', fontSize: 12.5 }}>
            ADMIN manages members · WRITE edits secrets · READ views and reveals
          </p>
        </div>
        {isProjectAdmin && (
          <button className="btn primary" onClick={openShare}>
            <i className="ti ti-user-plus" /> Share access
          </button>
        )}
      </div>

      {busy ? (
        <div style={{ display: 'flex', justifyContent: 'center', padding: 40 }}>
          <span className="spinner" />
        </div>
      ) : (
        <div className="card" style={{ overflow: 'hidden' }}>
          <table className="data">
            <thead>
              <tr>
                <th>Member</th>
                <th style={{ width: 140 }}>Role</th>
                <th style={{ width: 100 }} />
              </tr>
            </thead>
            <tbody>
              {members.map((m) => (
                <tr key={m.id}>
                  <td>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <div
                        style={{
                          width: 26,
                          height: 26,
                          borderRadius: '50%',
                          background: 'var(--ac-25)',
                          color: 'var(--al)',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          fontSize: 11,
                          fontWeight: 500,
                        }}
                      >
                        {(m.user.name || m.user.email).slice(0, 2).toUpperCase()}
                      </div>
                      <div>
                        <p style={{ margin: 0 }}>{m.user.name || m.user.email.split('@')[0]}</p>
                        <p className="muted" style={{ margin: 0, fontSize: 11.5 }}>
                          {m.user.email}
                        </p>
                      </div>
                    </div>
                  </td>
                  <td>
                    {isProjectAdmin && m.userId !== user.id ? (
                      <select
                        className="input"
                        value={m.role}
                        onChange={(e) => changeRole(m.userId, e.target.value)}
                        style={{ padding: '4px 8px', fontSize: 12 }}
                      >
                        <option value="ADMIN">ADMIN</option>
                        <option value="WRITE">WRITE</option>
                        <option value="READ">READ</option>
                      </select>
                    ) : (
                      <span className={`badge role-${m.role}`}>{m.role}</span>
                    )}
                  </td>
                  <td style={{ textAlign: 'right' }}>
                    {isProjectAdmin && m.userId !== user.id && (
                      <button
                        className="btn danger"
                        style={{ padding: '3px 8px' }}
                        onClick={() => removeMember(m.userId, m.user.email)}
                      >
                        <i className="ti ti-user-minus" />
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showShare && (
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
          onClick={() => setShowShare(false)}
        >
          <div
            className="card"
            style={{ width: 420, padding: 20 }}
            onClick={(e) => e.stopPropagation()}
          >
            <p style={{ fontWeight: 500, margin: '0 0 14px' }}>Share project access</p>

            {shareable.length > 0 && (
              <div style={{ marginBottom: 12 }}>
                <p className="muted" style={{ fontSize: 11.5, margin: '0 0 6px' }}>
                  Org members not yet in this project:
                </p>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {shareable.map((s) => (
                    <span
                      key={s.id}
                      className="badge"
                      style={{ cursor: 'pointer', padding: '3px 8px' }}
                      onClick={() => setShareEmail(s.user.email)}
                    >
                      {s.user.email}
                    </span>
                  ))}
                </div>
              </div>
            )}

            <label className="muted" style={{ display: 'block', fontSize: 11.5, marginBottom: 5 }}>
              Email
            </label>
            <input
              className="input"
              placeholder="teammate@org.com"
              value={shareEmail}
              onChange={(e) => setShareEmail(e.target.value)}
              style={{ marginBottom: 12 }}
            />
            <label className="muted" style={{ display: 'block', fontSize: 11.5, marginBottom: 5 }}>
              Role
            </label>
            <select
              className="input"
              value={shareRole}
              onChange={(e) => setShareRole(e.target.value as 'ADMIN' | 'WRITE' | 'READ')}
              style={{ marginBottom: 14 }}
            >
              <option value="READ">READ — view and reveal secrets</option>
              <option value="WRITE">WRITE — also add/edit secrets</option>
              <option value="ADMIN">ADMIN — also manage members and delete</option>
            </select>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button className="btn" onClick={() => setShowShare(false)}>
                Cancel
              </button>
              <button className="btn primary" onClick={share}>
                Share
              </button>
            </div>
          </div>
        </div>
      )}
    </AppShell>
  );
}
