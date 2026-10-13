'use client';

import { useCallback, useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { api, OrgDetail, OrgInvite } from '@/lib/api';
import { useUser } from '@/lib/useUser';
import { OrgShell } from '@/components/shell/AppShell';
import { Icon } from '@/components/Icon';
import { PageHeader, ErrorState, Modal } from '@/components/ui';
import { useToast } from '@/components/Toast';

const ORG_ROLE_BADGE: Record<string, string> = {
  OWNER: 'badge badge-accent',
  ADMIN: 'badge badge-warn',
  MEMBER: 'badge',
};

/** Build the shareable accept URL for an invite token. */
function inviteLink(token: string) {
  return `${window.location.origin}/invite/${token}`;
}

/** Organization management: rename, members & roles, email invites. */
export default function OrgPage() {
  const { orgId } = useParams<{ orgId: string }>();
  const router = useRouter();
  const { user, loading } = useUser();
  const toast = useToast();

  const [org, setOrg] = useState<OrgDetail | null>(null);
  const [invites, setInvites] = useState<OrgInvite[]>([]);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [name, setName] = useState('');
  const [savingName, setSavingName] = useState(false);
  const [showInvite, setShowInvite] = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<'MEMBER' | 'ADMIN'>('MEMBER');
  const [inviting, setInviting] = useState(false);
  const [createdInvite, setCreatedInvite] = useState<OrgInvite | null>(null);

  useEffect(() => {
    if (!loading && !user) router.push('/login');
  }, [loading, user, router]);

  const load = useCallback(async () => {
    if (!orgId) return;
    setBusy(true);
    try {
      const o = await api<OrgDetail>(`/orgs/${orgId}`);
      setOrg(o);
      setName(o.name);
      // Invites are admin-only; ignore 403 for plain members.
      try {
        const inv = await api<OrgInvite[]>(`/orgs/${orgId}/invites`);
        setInvites(inv);
      } catch {
        setInvites([]);
      }
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load');
    } finally {
      setBusy(false);
    }
  }, [orgId]);

  useEffect(() => {
    if (user) load();
  }, [user, load]);

  const yourRole = org?.members.find((m) => m.userId === user?.id)?.role;
  const isOrgAdmin = yourRole === 'OWNER' || yourRole === 'ADMIN';
  const isOwner = yourRole === 'OWNER';

  const saveName = async () => {
    if (!name.trim() || name.trim() === org?.name) return;
    setSavingName(true);
    try {
      await api(`/orgs/${orgId}`, { method: 'PATCH', body: JSON.stringify({ name: name.trim() }) });
      toast.show('Organization renamed');
      load();
    } catch (err) {
      toast.show(err instanceof Error ? err.message : 'Failed to rename', 'error');
    } finally {
      setSavingName(false);
    }
  };

  const changeRole = async (userId: string, role: string) => {
    try {
      await api(`/orgs/${orgId}/members/${userId}/role`, {
        method: 'POST',
        body: JSON.stringify({ role }),
      });
      toast.show('Role updated');
      load();
    } catch (err) {
      toast.show(err instanceof Error ? err.message : 'Failed to update role', 'error');
    }
  };

  const removeMember = async (userId: string, label: string) => {
    if (!confirm(`Remove ${label} from ${org?.name}? They will lose access to all its projects.`)) return;
    try {
      await api(`/orgs/${orgId}/members/${userId}`, { method: 'DELETE' });
      toast.show(`Removed ${label}`);
      load();
    } catch (err) {
      toast.show(err instanceof Error ? err.message : 'Failed to remove', 'error');
    }
  };

  const sendInvite = async () => {
    if (!inviteEmail.trim()) return;
    setInviting(true);
    try {
      const inv = await api<OrgInvite>(`/orgs/${orgId}/invite`, {
        method: 'POST',
        body: JSON.stringify({ email: inviteEmail.trim(), role: inviteRole }),
      });
      setCreatedInvite(inv);
      setShowInvite(false);
      setInviteEmail('');
      setInviteRole('MEMBER');
      load();
    } catch (err) {
      toast.show(err instanceof Error ? err.message : 'Failed to invite', 'error');
    } finally {
      setInviting(false);
    }
  };

  const copyInviteLink = async (inv: OrgInvite) => {
    if (!inv.token) return;
    await navigator.clipboard.writeText(inviteLink(inv.token));
    toast.show('Invite link copied');
  };

  const revokeInvite = async (inv: OrgInvite) => {
    try {
      await api(`/orgs/${orgId}/invites/${inv.id}`, { method: 'DELETE' });
      toast.show(`Revoked invite for ${inv.email}`);
      load();
    } catch (err) {
      toast.show(err instanceof Error ? err.message : 'Failed to revoke', 'error');
    }
  };

  if (loading || !user || (!org && busy)) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <span className="spinner" />
      </div>
    );
  }

  if (!org) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
        <ErrorState message={error ?? 'Organization not found'} onRetry={load} />
      </div>
    );
  }

  return (
    <OrgShell>
      <div className="page" style={{ maxWidth: 860 }}>
        <PageHeader
          title={org.name}
          description={
            <>
              Organization · <span className="mono">{org.slug}</span> · your role: {yourRole}
            </>
          }
          actions={
            isOrgAdmin ? (
              <button className="btn btn-primary" onClick={() => setShowInvite(true)}>
                <Icon name="plus" size={14} strokeWidth={2.2} />
                Invite member
              </button>
            ) : undefined
          }
        />

        {error && <ErrorState message={error} onRetry={load} />}

        {/* General */}
        {isOrgAdmin && (
          <section className="panel" style={{ marginBottom: 14 }}>
            <div className="panel-header">
              <h2>General</h2>
            </div>
            <div className="panel-body">
              <div className="field" style={{ marginBottom: 0 }}>
                <label className="field-label" htmlFor="org-name">
                  Organization name
                </label>
                <div style={{ display: 'flex', gap: 8, maxWidth: 460 }}>
                  <input
                    id="org-name"
                    className="input"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    style={{ flex: 1 }}
                  />
                  <button
                    className="btn btn-primary"
                    disabled={savingName || !name.trim() || name.trim() === org.name}
                    onClick={saveName}
                  >
                    {savingName ? 'Saving…' : 'Save'}
                  </button>
                </div>
              </div>
            </div>
          </section>
        )}

        {/* Members */}
        <section className="panel" style={{ marginBottom: 14 }}>
          <div className="panel-header">
            <h2>Members</h2>
            <span className="hint" style={{ marginLeft: 'auto' }}>
              {org.members.length}
            </span>
          </div>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Member</th>
                  <th>Role</th>
                  {isOrgAdmin && <th style={{ width: 1 }} />}
                </tr>
              </thead>
              <tbody>
                {org.members.map((m) => {
                  const label = m.user.name || m.user.email;
                  const isSelf = m.userId === user.id;
                  return (
                    <tr key={m.userId}>
                      <td>
                        <span style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                          <span
                            aria-hidden="true"
                            style={{
                              width: 26,
                              height: 26,
                              flex: '0 0 auto',
                              display: 'inline-flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              fontSize: 10,
                              fontWeight: 600,
                              color: 'var(--accent-soft)',
                              background: 'var(--chip)',
                              border: '1px solid var(--border-strong)',
                            }}
                          >
                            {label.slice(0, 2).toUpperCase()}
                          </span>
                          <span>
                            <strong style={{ fontWeight: 600, color: 'var(--text)', fontSize: 13 }}>
                              {label}
                            </strong>{' '}
                            {isSelf && <span className="muted" style={{ fontSize: 12 }}>(you)</span>}
                            <div className="muted" style={{ fontSize: 12 }}>
                              {m.user.email}
                            </div>
                          </span>
                        </span>
                      </td>
                      <td>
                        {isOrgAdmin && !isSelf ? (
                          <select
                            className="select"
                            value={m.role}
                            onChange={(e) => changeRole(m.userId, e.target.value)}
                            style={{ width: 130, padding: '4px 8px', fontSize: 12 }}
                          >
                            <option value="OWNER">OWNER</option>
                            <option value="ADMIN">ADMIN</option>
                            <option value="MEMBER">MEMBER</option>
                          </select>
                        ) : (
                          <span className={ORG_ROLE_BADGE[m.role] ?? 'badge'}>{m.role}</span>
                        )}
                      </td>
                      {isOrgAdmin && (
                        <td>
                          {!isSelf && (
                            <button className="btn btn-danger btn-sm" onClick={() => removeMember(m.userId, label)}>
                              <Icon name="trash" size={13} strokeWidth={2.2} />
                              Remove
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

        {/* Pending invites (admin only) */}
        {isOrgAdmin && (
          <section className="panel">
            <div className="panel-header">
              <h2>Pending invites</h2>
              <span className="hint" style={{ marginLeft: 'auto' }}>
                {invites.length}
              </span>
            </div>
            <div>
              {invites.length === 0 ? (
                <div className="empty">No pending invites.</div>
              ) : (
                invites.map((inv) => (
                  <div className="row" key={inv.id} style={{ alignItems: 'center', gap: 12 }}>
                    <span style={{ flex: 1, minWidth: 0, fontSize: 13, color: 'var(--text-2)' }}>
                      {inv.email}{' '}
                      <span className="muted" style={{ fontSize: 12 }}>
                        · expires {new Date(inv.expiresAt).toLocaleDateString()}
                      </span>
                    </span>
                    <span className={ORG_ROLE_BADGE[inv.role] ?? 'badge'}>{inv.role}</span>
                    {inv.token && (
                      <button className="btn btn-sm" onClick={() => copyInviteLink(inv)}>
                        <Icon name="copy" size={13} strokeWidth={2.2} />
                        Copy link
                      </button>
                    )}
                    <button className="btn btn-danger btn-sm" onClick={() => revokeInvite(inv)}>
                      Revoke
                    </button>
                  </div>
                ))
              )}
            </div>
          </section>
        )}

        {!isOrgAdmin && (
          <div className="notice">Only org owners and admins can manage members and invites.</div>
        )}
      </div>

      {/* Invite modal */}
      {showInvite && (
        <Modal
          title="Invite to organization"
          onClose={() => setShowInvite(false)}
          footer={
            <>
              <button className="btn" onClick={() => setShowInvite(false)}>
                Cancel
              </button>
              <button className="btn btn-primary" disabled={inviting || !inviteEmail.trim()} onClick={sendInvite}>
                {inviting ? 'Inviting…' : 'Create invite'}
              </button>
            </>
          }
        >
          <div className="field">
            <label className="field-label" htmlFor="invite-email">
              Email
            </label>
            <input
              id="invite-email"
              className="input"
              type="email"
              placeholder="teammate@example.com"
              value={inviteEmail}
              onChange={(e) => setInviteEmail(e.target.value)}
              autoFocus
            />
            <p className="field-help">
              You'll get a one-time invite link to share — it only works for this email address.
            </p>
          </div>
          <div className="field" style={{ marginBottom: 0 }}>
            <label className="field-label" htmlFor="invite-role">
              Org role
            </label>
            <select
              id="invite-role"
              className="select"
              value={inviteRole}
              onChange={(e) => setInviteRole(e.target.value as 'MEMBER' | 'ADMIN')}
            >
              <option value="MEMBER">MEMBER — can be added to projects</option>
              <option value="ADMIN">ADMIN — can manage org members</option>
            </select>
          </div>
        </Modal>
      )}

      {/* Show-once invite link */}
      {createdInvite?.token && (
        <Modal
          title="Invite created"
          onClose={() => setCreatedInvite(null)}
          width={560}
          footer={
            <>
              <button className="btn" onClick={() => copyInviteLink(createdInvite)}>
                <Icon name="copy" size={14} strokeWidth={2.2} />
                Copy link
              </button>
              <button className="btn btn-primary" onClick={() => setCreatedInvite(null)}>
                Done
              </button>
            </>
          }
        >
          <p style={{ margin: '0 0 10px', fontSize: 13, color: 'var(--text-2)' }}>
            Share this link with <strong>{createdInvite.email}</strong> — it's valid for 7 days and
            only works for that email address. No email is sent in this self-hosted setup.
          </p>
          <pre className="code-block mono" style={{ userSelect: 'all', wordBreak: 'break-all', whiteSpace: 'pre-wrap' }}>
            {inviteLink(createdInvite.token)}
          </pre>
        </Modal>
      )}
    </OrgShell>
  );
}
