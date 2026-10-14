'use client';

import { useCallback, useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { api, Project } from '@/lib/api';
import { useUser } from '@/lib/useUser';
import { ProjectShell } from '@/components/shell/AppShell';
import { Icon } from '@/components/Icon';
import { PageHeader, Loading, ErrorState, Modal } from '@/components/ui';
import { useToast } from '@/components/Toast';
import { useConfirm } from '@/components/Confirm';

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

const ROLE_BADGE: Record<string, string> = {
  ADMIN: 'badge badge-accent',
  WRITE: 'badge badge-warn',
  READ: 'badge',
};

export default function MembersPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const router = useRouter();
  const { user, loading } = useUser();
  const toast = useToast();
  const confirm = useConfirm();

  const [project, setProject] = useState<Project | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showShare, setShowShare] = useState(false);
  const [shareable, setShareable] = useState<ShareableMember[]>([]);
  const [shareEmail, setShareEmail] = useState('');
  const [shareRole, setShareRole] = useState<'ADMIN' | 'WRITE' | 'READ'>('READ');

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
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load');
    } finally {
      setBusy(false);
    }
  }, [projectId]);

  useEffect(() => {
    if (user) load();
  }, [user, load]);

  const isProjectAdmin = project?.yourRole === 'ADMIN';

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
    const ok = await confirm({
      title: 'Remove member',
      message: `Remove ${email} from this project?`,
      confirmLabel: 'Remove',
      danger: true,
    });
    if (!ok) return;
    try {
      await api(`/projects/${projectId}/members/${userId}`, { method: 'DELETE' });
      toast.show(`Removed ${email}`);
      load();
    } catch (err) {
      toast.show(err instanceof Error ? err.message : 'Failed', 'error');
    }
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
          title="Members"
          description="ADMIN manages members · WRITE edits secrets · READ views and reveals"
          actions={
            isProjectAdmin ? (
              <button className="btn btn-primary" onClick={openShare}>
                <Icon name="plus" size={14} strokeWidth={2.2} />
                Share access
              </button>
            ) : undefined
          }
        />

        {error && <ErrorState message={error} onRetry={load} />}
        {busy && !error && <Loading />}

        {!busy && !error && (
          <div className="panel table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Member</th>
                  <th style={{ width: 160 }}>Role</th>
                  <th style={{ width: 100 }} />
                </tr>
              </thead>
              <tbody>
                {members.map((m) => (
                  <tr key={m.id}>
                    <td>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <span
                          aria-hidden="true"
                          style={{
                            width: 26,
                            height: 26,
                            background: 'var(--chip)',
                            border: '1px solid var(--border-strong)',
                            color: 'var(--text-2)',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            fontSize: 10,
                            fontWeight: 700,
                          }}
                        >
                          {(m.user.name || m.user.email).slice(0, 2).toUpperCase()}
                        </span>
                        <span>
                          <span style={{ display: 'block', fontWeight: 500 }}>{m.user.name || m.user.email.split('@')[0]}</span>
                          <span className="subtle" style={{ fontSize: 12 }}>
                            {m.user.email}
                          </span>
                        </span>
                      </div>
                    </td>
                    <td>
                      {isProjectAdmin && m.userId !== user.id ? (
                        <select
                          className="select"
                          value={m.role}
                          onChange={(e) => changeRole(m.userId, e.target.value)}
                          style={{ padding: '5px 28px 5px 8px', fontSize: 12, width: 'auto' }}
                        >
                          <option value="ADMIN">ADMIN</option>
                          <option value="WRITE">WRITE</option>
                          <option value="READ">READ</option>
                        </select>
                      ) : (
                        <span className={ROLE_BADGE[m.role] ?? 'badge'}>{m.role}</span>
                      )}
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      {isProjectAdmin && m.userId !== user.id && (
                        <button className="btn btn-danger btn-sm" onClick={() => removeMember(m.userId, m.user.email)}>
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

      {showShare && (
        <Modal
          title="Share project access"
          onClose={() => setShowShare(false)}
          footer={
            <>
              <button className="btn" onClick={() => setShowShare(false)}>
                Cancel
              </button>
              <button className="btn btn-primary" onClick={share} disabled={!shareEmail.trim()}>
                Share
              </button>
            </>
          }
        >
          {shareable.length > 0 && (
            <div className="field">
              <span className="field-label">Org members not yet in this project</span>
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
          <div className="field">
            <label className="field-label">Email</label>
            <input
              className="input"
              placeholder="teammate@org.com"
              value={shareEmail}
              onChange={(e) => setShareEmail(e.target.value)}
              autoFocus
            />
            <span className="field-help">They must already be a member of the org.</span>
          </div>
          <div className="field">
            <label className="field-label">Role</label>
            <select className="select" value={shareRole} onChange={(e) => setShareRole(e.target.value as 'ADMIN' | 'WRITE' | 'READ')}>
              <option value="READ">READ — view and reveal secrets</option>
              <option value="WRITE">WRITE — also add/edit secrets</option>
              <option value="ADMIN">ADMIN — also manage members and delete</option>
            </select>
          </div>
        </Modal>
      )}
    </ProjectShell>
  );
}
