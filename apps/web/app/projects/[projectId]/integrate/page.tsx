'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { api, Project } from '@/lib/api';
import { useUser } from '@/lib/useUser';
import { ProjectShell } from '@/components/shell/AppShell';
import { PageHeader, ErrorState } from '@/components/ui';

/** CLI & SDK integration instructions for this project. */
export default function IntegratePage() {
  const { projectId } = useParams<{ projectId: string }>();
  const router = useRouter();
  const { user, loading } = useUser();
  const [project, setProject] = useState<Project | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!loading && !user) router.push('/login');
  }, [loading, user, router]);

  useEffect(() => {
    if (user && projectId) {
      api<Project>(`/projects/${projectId}`)
        .then(setProject)
        .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load'));
    }
  }, [user, projectId]);

  if (loading || !user || (!project && !error)) {
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
    <ProjectShell project={project}>
      <div className="page">
        <PageHeader
          title="Integrate"
          description={`Inject ${project.name} secrets into your apps — no .env files, nothing on disk`}
        />

        <div style={{ display: 'grid', gap: 14, maxWidth: 760 }}>
          <section className="panel">
            <div className="panel-header">
              <h2>Get started with the forge CLI</h2>
            </div>
            <pre className="code-block mono">{cli}</pre>
          </section>

          <section className="panel">
            <div className="panel-header">
              <h2>.secretforge.json (safe to commit)</h2>
              <span className="badge" style={{ marginLeft: 'auto' }}>
                project link
              </span>
            </div>
            <pre className="code-block mono">{link}</pre>
            <div className="panel-body" style={{ paddingTop: 10, paddingBottom: 12 }}>
              <p style={{ margin: 0, fontSize: 12, color: 'var(--text-3)' }}>
                Contains only the project ID and default environment — never any secrets.
              </p>
            </div>
          </section>

          <section className="panel">
            <div className="panel-header">
              <h2>CI / servers</h2>
              <span className="badge badge-warn" style={{ marginLeft: 'auto' }}>
                Phase 6
              </span>
            </div>
            <pre className="code-block mono">{ci}</pre>
            <div className="panel-body" style={{ paddingTop: 10, paddingBottom: 12 }}>
              <p style={{ margin: 0, fontSize: 12, color: 'var(--text-3)' }}>
                Service tokens are read-only, scoped to one environment, expiring, and revocable.
              </p>
            </div>
          </section>
        </div>
      </div>
    </ProjectShell>
  );
}
