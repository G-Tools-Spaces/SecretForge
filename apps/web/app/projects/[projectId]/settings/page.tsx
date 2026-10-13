'use client';

import { useCallback, useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { api, Project } from '@/lib/api';
import { envLabel } from '@/lib/format';
import { useUser } from '@/lib/useUser';
import { ProjectShell } from '@/components/shell/AppShell';
import { Icon } from '@/components/Icon';
import { PageHeader, ErrorState, Modal } from '@/components/ui';
import { useToast } from '@/components/Toast';

/** Project settings: rename, environments, and the danger zone (ADMIN). */
export default function SettingsPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const router = useRouter();
  const { user, loading } = useUser();
  const toast = useToast();

  const [project, setProject] = useState<Project | null>(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [name, setName] = useState('');
  const [savingName, setSavingName] = useState(false);
  const [newEnv, setNewEnv] = useState('');
  const [addingEnv, setAddingEnv] = useState(false);
  const [showDelete, setShowDelete] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState('');
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    if (!loading && !user) router.push('/login');
  }, [loading, user, router]);

  const load = useCallback(async () => {
    if (!projectId) return;
    setBusy(true);
    try {
      const p = await api<Project>(`/projects/${projectId}`);
      setProject(p);
      setName(p.name);
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

  const isAdmin = project?.yourRole === 'ADMIN';

  const saveName = async () => {
    if (!name.trim() || name.trim() === project?.name) return;
    setSavingName(true);
    try {
      await api(`/projects/${projectId}`, {
        method: 'PATCH',
        body: JSON.stringify({ name: name.trim() }),
      });
      toast.show('Project renamed');
      load();
    } catch (err) {
      toast.show(err instanceof Error ? err.message : 'Failed to rename', 'error');
    } finally {
      setSavingName(false);
    }
  };

  const addEnv = async () => {
    if (!newEnv.trim()) return;
    setAddingEnv(true);
    try {
      await api(`/projects/${projectId}/envs`, {
        method: 'POST',
        body: JSON.stringify({ name: newEnv.trim() }),
      });
      toast.show(`Environment "${newEnv.trim().toLowerCase()}" added`);
      setNewEnv('');
      load();
    } catch (err) {
      toast.show(err instanceof Error ? err.message : 'Failed to add environment', 'error');
    } finally {
      setAddingEnv(false);
    }
  };

  const deleteProject = async () => {
    if (deleteConfirm !== project?.name) return;
    setDeleting(true);
    try {
      await api(`/projects/${projectId}`, { method: 'DELETE' });
      toast.show(`Deleted ${project?.name}`);
      router.push('/projects');
    } catch (err) {
      toast.show(err instanceof Error ? err.message : 'Failed to delete', 'error');
      setDeleting(false);
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
      <div className="page" style={{ maxWidth: 720 }}>
        <PageHeader title="Settings" description={`Manage ${project.name}`} />

        {error && <ErrorState message={error} onRetry={load} />}

        {!isAdmin && (
          <div className="notice" style={{ marginBottom: 14 }}>
            You have the {project.yourRole} role — only project admins can change settings.
          </div>
        )}

        {/* General */}
        <section className="panel" style={{ marginBottom: 14 }}>
          <div className="panel-header">
            <h2>General</h2>
          </div>
          <div className="panel-body">
            <div className="field">
              <label className="field-label" htmlFor="project-name">
                Project name
              </label>
              <div style={{ display: 'flex', gap: 8 }}>
                <input
                  id="project-name"
                  className="input"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  disabled={!isAdmin}
                  style={{ flex: 1 }}
                />
                {isAdmin && (
                  <button
                    className="btn btn-primary"
                    disabled={savingName || !name.trim() || name.trim() === project.name}
                    onClick={saveName}
                  >
                    {savingName ? 'Saving…' : 'Save'}
                  </button>
                )}
              </div>
              <p className="field-help">
                Slug <span className="mono">{project.slug}</span> and project ID stay unchanged.
              </p>
            </div>
          </div>
        </section>

        {/* Environments */}
        <section className="panel" style={{ marginBottom: 14 }}>
          <div className="panel-header">
            <h2>Environments</h2>
            <span className="hint" style={{ marginLeft: 'auto' }}>
              {project.environments.length}
            </span>
          </div>
          <div className="panel-body">
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: isAdmin ? 14 : 0 }}>
              {project.environments.map((e) => (
                <span key={e.id} className="badge badge-accent" style={{ fontSize: 12, padding: '4px 10px' }}>
                  {envLabel(e.name)}
                </span>
              ))}
            </div>
            {isAdmin && (
              <div className="field" style={{ marginBottom: 0 }}>
                <label className="field-label" htmlFor="new-env">
                  Add environment
                </label>
                <div style={{ display: 'flex', gap: 8 }}>
                  <input
                    id="new-env"
                    className="input"
                    placeholder="qa"
                    value={newEnv}
                    onChange={(e) => setNewEnv(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && addEnv()}
                    style={{ flex: 1 }}
                  />
                  <button className="btn" disabled={addingEnv || !newEnv.trim()} onClick={addEnv}>
                    <Icon name="plus" size={14} strokeWidth={2.2} />
                    {addingEnv ? 'Adding…' : 'Add'}
                  </button>
                </div>
                <p className="field-help">Lowercase letters, digits, and dashes (e.g. qa, preview-2).</p>
              </div>
            )}
          </div>
        </section>

        {/* Danger zone */}
        {isAdmin && (
          <section className="panel" style={{ borderColor: 'var(--danger-border)' }}>
            <div className="panel-header" style={{ borderColor: 'var(--danger-border)' }}>
              <h2 style={{ color: 'var(--danger-soft)' }}>Danger zone</h2>
            </div>
            <div className="panel-body" style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>Delete this project</div>
                <p style={{ margin: '4px 0 0', fontSize: 12, color: 'var(--text-3)' }}>
                  Permanently deletes all environments, secrets, version history, members, and service
                  tokens. This cannot be undone.
                </p>
              </div>
              <button className="btn btn-danger" onClick={() => setShowDelete(true)}>
                <Icon name="trash" size={14} strokeWidth={2.2} />
                Delete project
              </button>
            </div>
          </section>
        )}
      </div>

      {/* Delete confirmation */}
      {showDelete && (
        <Modal
          title="Delete project"
          onClose={() => {
            setShowDelete(false);
            setDeleteConfirm('');
          }}
          footer={
            <>
              <button
                className="btn"
                onClick={() => {
                  setShowDelete(false);
                  setDeleteConfirm('');
                }}
              >
                Cancel
              </button>
              <button
                className="btn btn-danger"
                disabled={deleting || deleteConfirm !== project.name}
                onClick={deleteProject}
              >
                {deleting ? 'Deleting…' : 'Delete forever'}
              </button>
            </>
          }
        >
          <p style={{ margin: '0 0 10px', fontSize: 13, color: 'var(--text-2)' }}>
            Type <strong className="mono" style={{ color: 'var(--danger-soft)' }}>{project.name}</strong> to
            confirm deletion.
          </p>
          <input
            className="input"
            value={deleteConfirm}
            onChange={(e) => setDeleteConfirm(e.target.value)}
            placeholder={project.name}
            autoFocus
          />
        </Modal>
      )}
    </ProjectShell>
  );
}
