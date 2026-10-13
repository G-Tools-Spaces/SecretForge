'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { api, Project } from '@/lib/api';
import { useUser } from '@/lib/useUser';
import { AppShell, ProjectSidebar } from '@/components/AppShell';

/** CLI & SDK integration instructions for this project. */
export default function IntegratePage() {
  const { projectId } = useParams<{ projectId: string }>();
  const router = useRouter();
  const { user, loading } = useUser();
  const [project, setProject] = useState<Project | null>(null);

  useEffect(() => {
    if (!loading && !user) router.push('/login');
  }, [loading, user, router]);

  useEffect(() => {
    if (user && projectId) {
      api<Project>(`/projects/${projectId}`)
        .then(setProject)
        .catch(() => {});
    }
  }, [user, projectId]);

  if (loading || !user) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <span className="spinner" />
      </div>
    );
  }

  const cli = `# Install the CLI
cd packages/cli && npm run build
npm link   # or: npm i -g .

# Link this repo to the project
forge init

# Run your app with secrets injected — no .env file needed
forge run --env dev -- npm run dev`;

  const link = `{
  "projectId": "${projectId}",
  "defaultEnv": "dev"
}`;

  const ci = `# CI (GitHub Actions) — service tokens arrive in Phase 6
SECRETFORGE_TOKEN=sf_... forge run --env prod -- npm test`;

  return (
    <AppShell
      breadcrumb={
        <span className="muted" style={{ marginLeft: 6 }}>
          / {project?.org.name} / <span style={{ color: 'var(--tx)' }}>{project?.name}</span>
        </span>
      }
      sidebar={<ProjectSidebar projectId={projectId} active="integrate" />}
    >
      <div style={{ marginBottom: 16 }}>
        <p style={{ fontSize: 20, fontWeight: 500, margin: 0 }}>CLI and SDK</p>
        <p className="muted" style={{ margin: '4px 0 0', fontSize: 12.5 }}>
          Inject {project?.name} secrets into your apps — no .env files, nothing on disk
        </p>
      </div>

      <div style={{ display: 'grid', gap: 12, maxWidth: 720 }}>
        <div className="card">
          <div className="card-head">
            <span>Get started with the forge CLI</span>
          </div>
          <pre
            className="mono"
            style={{
              margin: 0,
              padding: 14,
              background: 'var(--bg)',
              borderRadius: '0 0 8px 8px',
              overflowX: 'auto',
              color: 'var(--al)',
              fontSize: 11.5,
              lineHeight: 1.6,
            }}
          >
            {cli}
          </pre>
        </div>

        <div className="card">
          <div className="card-head">
            <span>.secretforge.json (safe to commit)</span>
            <span className="badge">project link</span>
          </div>
          <pre
            className="mono"
            style={{
              margin: 0,
              padding: 14,
              background: 'var(--bg)',
              borderRadius: '0 0 8px 8px',
              overflowX: 'auto',
              color: 'var(--al)',
              fontSize: 11.5,
              lineHeight: 1.6,
            }}
          >
            {link}
          </pre>
          <p className="muted" style={{ padding: '0 14px 12px', fontSize: 11.5, margin: 0 }}>
            Contains only the project ID and default environment — never any secrets.
          </p>
        </div>

        <div className="card">
          <div className="card-head">
            <span>CI / servers</span>
            <span className="badge">Phase 6</span>
          </div>
          <pre
            className="mono"
            style={{
              margin: 0,
              padding: 14,
              background: 'var(--bg)',
              borderRadius: '0 0 8px 8px',
              overflowX: 'auto',
              color: 'var(--al)',
              fontSize: 11.5,
              lineHeight: 1.6,
            }}
          >
            {ci}
          </pre>
          <p className="muted" style={{ padding: '0 14px 12px', fontSize: 11.5, margin: 0 }}>
            Service tokens are read-only, scoped to one environment, expiring, and revocable.
          </p>
        </div>
      </div>
    </AppShell>
  );
}
