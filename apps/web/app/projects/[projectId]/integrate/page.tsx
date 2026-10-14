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

  const cli = `# Install the CLI (Node.js 20+ required)
npm install -g @gtools-spaces/cli

# Point it at your server (only if not http://localhost:4000)
export SECRETFORGE_URL="https://secretforge-api.onrender.com"

# Log in — opens your browser; works with Google/GitHub
# sign-in and 2FA (use --password for a terminal prompt)
forge login

# Link this repo to the project
forge init

# Monorepo? Pin a secret group per service directory
forge init --group backend

# Run your app with secrets injected — no .env file needed
forge run --env dev -- npm run dev
forge run --group backend -- npm start   # only that group's secrets`;

  const link = `{
  "projectId": "${projectId}",
  "defaultEnv": "dev",
  "group": "backend"
}`;

  const sdk = `// ⚠️ Not on npm yet — install from a repo checkout:
//   npm run build -w packages/sdk-node
//   npm i <your-SecretForge-clone>/packages/sdk-node
import { config } from '@gtools-spaces/sdk';

// Fetches secrets once at boot and merges them into process.env.
// Real environment variables always win over the vault.
await config(); // uses SECRETFORGE_TOKEN + .secretforge.json

// Service-scoped secrets (monorepo): pick a group
await config({ group: 'backend' }); // or set SECRETFORGE_GROUP=backend`;

  const pySdk = `# pip install secretforge   (Python 3.9+, stdlib only)
import secretforge

# Merges vault secrets into os.environ.
# Real environment variables always win over the vault.
secretforge.config()  # uses SECRETFORGE_TOKEN + .secretforge.json

# Service-scoped secrets (monorepo): pick a group
secretforge.config(group='backend')  # or set SECRETFORGE_GROUP=backend`;

  const groups = `# Same key can live in several groups — create them in the Secrets tab
forge set DATABASE_URL=... --group backend
forge run  --group backend -- npm start

# Node SDK:   await config({ group: 'backend' })
# Python SDK: secretforge.config(group='backend')`;

  const ci = `# 1. Create a token: Tokens tab → New token (pick the env)
# 2. Store it as a CI secret named SECRETFORGE_TOKEN

# ⚠️ SECRETFORGE_URL = API URL (https://...) — SECRETFORGE_TOKEN = service token (sf_...)
#    Don't mix these up; the CLI will refuse a sf_... value in SECRETFORGE_URL.

# GitHub Actions
- name: Tests with vault secrets
  env:
    SECRETFORGE_TOKEN: \${{ secrets.SECRETFORGE_TOKEN }}
  run: npx @gtools-spaces/cli run --env prod -- npm test`;

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
                Contains only the project ID, default environment and an optional group — never any
                secrets. The group field is written by forge init --group.
              </p>
            </div>
          </section>

          <section className="panel">
            <div className="panel-header">
              <h2>Node SDK</h2>
              <span className="badge" style={{ marginLeft: 'auto' }}>
                @gtools-spaces/sdk
              </span>
            </div>
            <pre className="code-block mono">{sdk}</pre>
          </section>

          <section className="panel">
            <div className="panel-header">
              <h2>Python SDK</h2>
              <span className="badge" style={{ marginLeft: 'auto' }}>
                secretforge
              </span>
            </div>
            <pre className="code-block mono">{pySdk}</pre>
          </section>

          <section className="panel">
            <div className="panel-header">
              <h2>Secret groups</h2>
              <span className="badge" style={{ marginLeft: 'auto' }}>
                monorepos
              </span>
            </div>
            <pre className="code-block mono">{groups}</pre>
            <div className="panel-body" style={{ paddingTop: 10, paddingBottom: 12 }}>
              <p style={{ margin: 0, fontSize: 12, color: 'var(--text-3)' }}>
                The same key can exist in several groups (e.g. a different DATABASE_URL for backend and
                worker). Resolution: --group flag &gt; SECRETFORGE_GROUP &gt; .secretforge.json &gt;
                ungrouped. Service tokens are environment-scoped — one token reads every group in its
                environment.
              </p>
            </div>
          </section>

          <section className="panel">
            <div className="panel-header">
              <h2>CI / servers</h2>
              <span className="badge badge-ok" style={{ marginLeft: 'auto' }}>
                service tokens
              </span>
            </div>
            <pre className="code-block mono">{ci}</pre>
            <div className="panel-body" style={{ paddingTop: 10, paddingBottom: 12 }}>
              <p style={{ margin: 0, fontSize: 12, color: 'var(--text-3)' }}>
                Service tokens are read-only, scoped to one environment, expiring, and revocable.
                Manage them in the Tokens tab.
              </p>
            </div>
          </section>
        </div>
      </div>
    </ProjectShell>
  );
}
