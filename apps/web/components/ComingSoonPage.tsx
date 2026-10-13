'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { api, Project } from '@/lib/api';
import { useUser } from '@/lib/useUser';
import { ProjectShell } from '@/components/shell/AppShell';
import { Icon, IconName } from '@/components/Icon';
import { PageHeader, ErrorState } from '@/components/ui';

/** Placeholder page for features that land in a later phase. */
export function ComingSoonPage({
  title,
  description,
  icon,
  phase,
}: {
  title: string;
  description: string;
  icon: IconName;
  phase: string;
}) {
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

  return (
    <ProjectShell project={project}>
      <div className="page">
        <PageHeader title={title} description={description} />
        <section className="panel">
          <div
            className="empty"
            style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12, padding: '56px 18px' }}
          >
            <span
              style={{
                width: 44,
                height: 44,
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                background: 'var(--chip)',
                border: '1px solid var(--border-strong)',
                color: 'var(--accent-soft)',
              }}
            >
              <Icon name={icon} size={20} />
            </span>
            <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)' }}>
              Coming in {phase}
            </div>
            <p style={{ margin: 0, fontSize: 13, color: 'var(--text-3)', maxWidth: 420, textAlign: 'center' }}>
              {description}
            </p>
          </div>
        </section>
      </div>
    </ProjectShell>
  );
}
