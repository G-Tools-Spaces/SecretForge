'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, Org, Project } from '@/lib/api';
import { useUser } from '@/lib/useUser';
import { OrgShell } from '@/components/shell/AppShell';
import { Icon } from '@/components/Icon';
import { PageHeader, Loading, ErrorState, Modal } from '@/components/ui';
import { useToast } from '@/components/Toast';

export default function ProjectsPage() {
  const { user, loading } = useUser();
  const router = useRouter();
  const toast = useToast();
  const [orgs, setOrgs] = useState<Org[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [newOrgName, setNewOrgName] = useState('');
  const [newProjectName, setNewProjectName] = useState('');
  const [newProjectOrg, setNewProjectOrg] = useState('');

  useEffect(() => {
    if (!loading && !user) router.push('/login');
  }, [loading, user, router]);

  const load = async () => {
    try {
      const [o, p] = await Promise.all([api<Org[]>('/orgs'), api<Project[]>('/projects')]);
      setOrgs(o);
      setProjects(p);
      if (o.length > 0) setNewProjectOrg(o[0].id);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load');
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    if (!user) return;
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  const createOrg = async () => {
    if (!newOrgName.trim()) return;
    try {
      await api('/orgs', { method: 'POST', body: JSON.stringify({ name: newOrgName }) });
      toast.show(`Created org "${newOrgName}"`);
      setNewOrgName('');
      const o = await api<Org[]>('/orgs');
      setOrgs(o);
      if (o.length > 0) setNewProjectOrg(o[0].id);
    } catch (err) {
      toast.show(err instanceof Error ? err.message : 'Failed', 'error');
    }
  };

  const createProject = async () => {
    if (!newProjectName.trim() || !newProjectOrg) return;
    try {
      const p = await api<Project>('/projects', {
        method: 'POST',
        body: JSON.stringify({ orgId: newProjectOrg, name: newProjectName }),
      });
      toast.show(`Created project "${p.name}" with dev/staging/prod environments`);
      setShowCreate(false);
      setNewProjectName('');
      router.push(`/projects/${p.id}/secrets`);
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
    <OrgShell>
      <div className="page">
        <PageHeader
          title="Projects"
          description={`Secrets vaults for your team. Each project gets dev, staging, and prod environments.`}
          actions={
            orgs.length > 0 ? (
              <button className="btn btn-primary" onClick={() => setShowCreate(true)}>
                <Icon name="plus" size={14} strokeWidth={2.2} />
                New project
              </button>
            ) : undefined
          }
        />

        {error && <ErrorState message={error} onRetry={load} />}
        {busy && !error && <Loading />}

        {!busy && !error && projects.length === 0 && (
          <div className="panel">
            <div className="empty" style={{ padding: '56px 18px' }}>
              <h2 style={{ margin: '0 0 6px', fontSize: 16, color: 'var(--text)' }}>
                {orgs.length === 0 ? 'Create your organization' : 'Create your first project'}
              </h2>
              <p style={{ margin: '0 0 16px' }}>
                {orgs.length === 0
                  ? 'An org is the home for your team and its projects.'
                  : 'Store encrypted secrets, share with your team, inject via CLI.'}
              </p>
              {orgs.length === 0 ? (
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    createOrg();
                  }}
                  style={{ display: 'flex', gap: 8, justifyContent: 'center', maxWidth: 420, margin: '0 auto' }}
                >
                  <input
                    className="input"
                    placeholder="Org name (e.g. Acme dev team)"
                    value={newOrgName}
                    onChange={(e) => setNewOrgName(e.target.value)}
                    autoFocus
                  />
                  <button type="submit" className="btn btn-primary" disabled={!newOrgName.trim()}>
                    <Icon name="building" size={14} strokeWidth={2.2} />
                    Create org
                  </button>
                </form>
              ) : (
                <button className="btn btn-primary" onClick={() => setShowCreate(true)}>
                  <Icon name="plus" size={14} strokeWidth={2.2} />
                  New project
                </button>
              )}
            </div>
          </div>
        )}

        {!busy && !error && projects.length > 0 && (
          <div className="grid-auto">
            {projects.map((p) => (
              <a
                key={p.id}
                href={`/projects/${p.id}/secrets`}
                className="panel"
                style={{ textDecoration: 'none', color: 'var(--text)' }}
              >
                <div
                  style={{
                    display: 'flex',
                    gap: 12,
                    alignItems: 'center',
                    padding: '16px 18px',
                    borderBottom: '1px solid var(--border)',
                  }}
                >
                  <span
                    aria-hidden="true"
                    style={{
                      width: 38,
                      height: 38,
                      flex: 'none',
                      color: '#0b2f2a',
                      background: 'var(--accent-strong)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontSize: 13,
                      fontWeight: 700,
                    }}
                  >
                    {p.name.slice(0, 2).toUpperCase()}
                  </span>
                  <span style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0, flex: 1 }}>
                    <strong style={{ fontSize: 15, fontWeight: 700, letterSpacing: '-0.01em' }}>{p.name}</strong>
                    <span className="mono" style={{ fontSize: 12, color: 'var(--text-4)' }}>
                      {p.org.name}
                    </span>
                  </span>
                </div>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', padding: '12px 18px' }}>
                  {p.environments.map((e) => (
                    <span key={e.id} className="badge">
                      {e.name}
                    </span>
                  ))}
                </div>
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    padding: '10px 18px',
                    borderTop: '1px solid var(--border)',
                    fontSize: 12,
                    color: 'var(--text-4)',
                  }}
                >
                  <span className="mono">{p.id.slice(0, 8)}</span>
                  <span>{p._count?.members ?? 1} member(s)</span>
                </div>
              </a>
            ))}
            <button
              onClick={() => setShowCreate(true)}
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 10,
                minHeight: 160,
                border: '1px dashed var(--border-strong)',
                background: 'transparent',
                color: 'var(--text-3)',
                fontSize: 13,
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              <Icon name="plus" size={20} />
              Create a project
            </button>
          </div>
        )}
      </div>

      {showCreate && (
        <Modal
          title="New project"
          onClose={() => setShowCreate(false)}
          footer={
            <>
              <button className="btn" onClick={() => setShowCreate(false)}>
                Cancel
              </button>
              <button className="btn btn-primary" onClick={createProject} disabled={!newProjectName.trim() || !newProjectOrg}>
                Create project
              </button>
            </>
          }
        >
          <div className="field">
            <label className="field-label">Organization</label>
            <select className="select" value={newProjectOrg} onChange={(e) => setNewProjectOrg(e.target.value)}>
              {orgs.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label className="field-label">Project name</label>
            <input
              className="input"
              placeholder="payments-api"
              value={newProjectName}
              onChange={(e) => setNewProjectName(e.target.value)}
              autoFocus
            />
            <span className="field-help">Creates dev, staging, and prod environments automatically.</span>
          </div>
        </Modal>
      )}
    </OrgShell>
  );
}
