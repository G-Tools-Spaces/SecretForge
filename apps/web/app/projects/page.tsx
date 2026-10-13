'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, Org, Project } from '@/lib/api';
import { useUser } from '@/lib/useUser';
import { AppShell } from '@/components/AppShell';
import { useToast } from '@/components/Toast';

export default function ProjectsPage() {
  const { user, loading } = useUser();
  const router = useRouter();
  const toast = useToast();
  const [orgs, setOrgs] = useState<Org[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [busy, setBusy] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [newOrgName, setNewOrgName] = useState('');
  const [newProjectName, setNewProjectName] = useState('');
  const [newProjectOrg, setNewProjectOrg] = useState('');

  useEffect(() => {
    if (!loading && !user) router.push('/login');
  }, [loading, user, router]);

  useEffect(() => {
    if (!user) return;
    (async () => {
      try {
        const [o, p] = await Promise.all([
          api<Org[]>('/orgs'),
          api<Project[]>('/projects'),
        ]);
        setOrgs(o);
        setProjects(p);
        if (o.length > 0) setNewProjectOrg(o[0].id);
      } catch (err) {
        toast.show(err instanceof Error ? err.message : 'Failed to load', 'error');
      } finally {
        setBusy(false);
      }
    })();
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
    <AppShell>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 18 }}>
        <div>
          <p style={{ fontSize: 20, fontWeight: 500, margin: 0 }}>Projects</p>
          <p className="muted" style={{ margin: '4px 0 0', fontSize: 12.5 }}>
            {projects.length} project{projects.length === 1 ? '' : 's'} across {orgs.length} org
            {orgs.length === 1 ? '' : 's'}
          </p>
        </div>
        <button className="btn primary" onClick={() => setShowCreate(true)}>
          <i className="ti ti-plus" /> New project
        </button>
      </div>

      {busy ? (
        <div style={{ display: 'flex', justifyContent: 'center', padding: 40 }}>
          <span className="spinner" />
        </div>
      ) : projects.length === 0 ? (
        <div className="card" style={{ padding: 40, textAlign: 'center' }}>
          <i className="ti ti-folder-off" style={{ fontSize: 32, color: 'var(--mu)' }} />
          <p style={{ marginTop: 12, fontWeight: 500 }}>No projects yet</p>
          <p className="muted" style={{ fontSize: 12.5 }}>
            Create a project to start storing secrets. Each project gets dev, staging, and prod
            environments automatically.
          </p>
          {orgs.length === 0 && (
            <div style={{ marginTop: 16, display: 'flex', gap: 8, justifyContent: 'center' }}>
              <input
                className="input"
                style={{ width: 240 }}
                placeholder="First, name your org (e.g. Acme dev team)"
                value={newOrgName}
                onChange={(e) => setNewOrgName(e.target.value)}
              />
              <button className="btn" onClick={createOrg}>
                Create org
              </button>
            </div>
          )}
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 12 }}>
          {projects.map((p) => (
            <div
              key={p.id}
              className="card"
              style={{ padding: 16, cursor: 'pointer' }}
              onClick={() => router.push(`/projects/${p.id}/secrets`)}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
                <div
                  style={{
                    width: 34,
                    height: 34,
                    borderRadius: 8,
                    background: 'var(--ac)',
                    color: '#fff',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontWeight: 500,
                    fontSize: 13,
                  }}
                >
                  {p.name.slice(0, 2).toUpperCase()}
                </div>
                <div>
                  <p style={{ margin: 0, fontWeight: 500 }}>{p.name}</p>
                  <p className="muted mono" style={{ margin: 0, fontSize: 11 }}>
                    {p.org.name}
                  </p>
                </div>
              </div>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {p.environments.map((e) => (
                  <span key={e.id} className="badge">
                    {e.name}
                  </span>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {showCreate && (
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
          onClick={() => setShowCreate(false)}
        >
          <div
            className="card"
            style={{ width: 380, padding: 20 }}
            onClick={(e) => e.stopPropagation()}
          >
            <p style={{ fontWeight: 500, margin: '0 0 14px' }}>New project</p>
            <label className="muted" style={{ display: 'block', fontSize: 11.5, marginBottom: 5 }}>
              Organization
            </label>
            <select
              className="input"
              value={newProjectOrg}
              onChange={(e) => setNewProjectOrg(e.target.value)}
              style={{ marginBottom: 12 }}
            >
              {orgs.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
            </select>
            <label className="muted" style={{ display: 'block', fontSize: 11.5, marginBottom: 5 }}>
              Project name
            </label>
            <input
              className="input"
              placeholder="payments-api"
              value={newProjectName}
              onChange={(e) => setNewProjectName(e.target.value)}
              autoFocus
            />
            <p className="muted" style={{ fontSize: 11.5, margin: '10px 0 16px' }}>
              Creates dev, staging, and prod environments automatically.
            </p>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button className="btn" onClick={() => setShowCreate(false)}>
                Cancel
              </button>
              <button className="btn primary" onClick={createProject}>
                Create project
              </button>
            </div>
          </div>
        </div>
      )}
    </AppShell>
  );
}
