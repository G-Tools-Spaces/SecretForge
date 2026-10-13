'use client';

import Link from 'next/link';
import { useUser } from '@/lib/useUser';

/**
 * Public documentation page — no auth required. Anchor-nav layout:
 * sticky section index on the left, content panels on the right.
 */

const SECTIONS = [
  { id: 'getting-started', label: 'Getting started' },
  { id: 'cli', label: 'CLI' },
  { id: 'tokens', label: 'Service tokens' },
  { id: 'sdk-node', label: 'Node SDK' },
  { id: 'sdk-python', label: 'Python SDK' },
  { id: 'ci', label: 'CI integration' },
  { id: 'roles', label: 'Roles & permissions' },
  { id: 'security', label: 'Security model' },
  { id: 'api', label: 'API reference' },
] as const;

export default function DocsPage() {
  const { user } = useUser();

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg)' }}>
      {/* Minimal public header */}
      <header
        style={{
          position: 'sticky',
          top: 0,
          zIndex: 10,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          height: 48,
          padding: '0 20px',
          background: 'var(--bg-sidebar)',
          borderBottom: '1px solid var(--border)',
        }}
      >
        <Link
          href="/projects"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            textDecoration: 'none',
            color: 'var(--text)',
            fontWeight: 700,
            fontSize: 14,
          }}
        >
          <span
            aria-hidden="true"
            style={{
              width: 22,
              height: 22,
              background: 'var(--accent-strong)',
              color: '#0b2f2a',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 12,
              fontWeight: 700,
            }}
          >
            S
          </span>
          SecretForge
          <span style={{ color: 'var(--text-4)', fontWeight: 400 }}>/ Docs</span>
        </Link>
        <Link href={user ? '/projects' : '/login'} className="btn btn-sm" style={{ textDecoration: 'none' }}>
          {user ? 'Open app' : 'Sign in'}
        </Link>
      </header>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '200px minmax(0, 780px)',
          gap: 32,
          maxWidth: 1060,
          margin: '0 auto',
          padding: '32px 24px 80px',
        }}
      >
        {/* Section index */}
        <nav aria-label="Docs sections" style={{ position: 'sticky', top: 72, alignSelf: 'start' }}>
          {SECTIONS.map((sec) => (
            <a
              key={sec.id}
              href={`#${sec.id}`}
              style={{
                display: 'block',
                padding: '6px 10px',
                fontSize: 13,
                color: 'var(--text-3)',
                textDecoration: 'none',
                borderLeft: '2px solid var(--border)',
              }}
            >
              {sec.label}
            </a>
          ))}
        </nav>

        <main style={{ display: 'grid', gap: 14, minWidth: 0 }}>
          <div>
            <h1 style={{ margin: 0, fontSize: 24, fontWeight: 700, letterSpacing: '-0.02em' }}>
              SecretForge docs
            </h1>
            <p style={{ margin: '8px 0 0', fontSize: 14, color: 'var(--text-3)' }}>
              Centralized secrets for your team — encrypted at rest, injected at runtime, audited always.
              No more .env files.
            </p>
          </div>

          {/* Getting started */}
          <DocSection id="getting-started" title="Getting started">
            <ol style={{ margin: 0, paddingLeft: 18, display: 'grid', gap: 8, fontSize: 13, color: 'var(--text-2)' }}>
              <li>Sign up, then create an <strong>organization</strong> for your team.</li>
              <li>Create a <strong>project</strong> inside the org — it gets Development, Staging, and Production environments automatically.</li>
              <li>Add secrets on the <strong>Secrets</strong> tab (or bulk-paste a .env via <em>Import</em>).</li>
              <li>Invite teammates from <strong>Members</strong> with per-project roles.</li>
              <li>Install the CLI or SDK to inject secrets into your apps.</li>
            </ol>
          </DocSection>

          {/* CLI */}
          <DocSection id="cli" title="CLI">
            <Code>{`# Install
cd packages/cli && npm run build
npm link   # or: npm i -g .

forge login                        # stores tokens in ~/.secretforge (chmod 600)
forge init                         # link this repo → writes .secretforge.json
forge set API_KEY=abc123 --env dev # prompts hidden if value omitted
forge list --env dev               # keys + versions only, never values
forge run --env dev -- npm run dev # inject secrets into the child process
forge pull --env dev --stdout      # escape hatch: print .env format
forge import .env --env dev        # migrate an existing .env file`}</Code>
            <Note>
              <span className="mono">.secretforge.json</span> contains only the project ID and default
              environment — safe to commit. Env resolution: <span className="mono">--env</span> flag &gt;{' '}
              <span className="mono">SECRETFORGE_ENV</span> &gt; project default &gt; dev.
            </Note>
          </DocSection>

          {/* Service tokens */}
          <DocSection id="tokens" title="Service tokens">
            <P>
              Service tokens are <strong>read-only</strong>, scoped to <strong>one environment</strong>,
              expiring, and revocable — built for CI and servers. Only the SHA-256 hash is stored; the
              plaintext <span className="mono">sf_...</span> token is shown once at creation.
            </P>
            <P>
              Create them under <strong>Project → Tokens</strong> (admins only), then use the token anywhere
              via the <span className="mono">SECRETFORGE_TOKEN</span> env var — no{' '}
              <span className="mono">forge login</span> needed:
            </P>
            <Code>{`SECRETFORGE_TOKEN=sf_... forge run --env prod -- node server.js`}</Code>
            <Note>
              Misuse is audited: wrong-environment reads, write attempts, and revoked/expired usage all
              appear in the audit log with the token's name (never the token itself).
            </Note>
          </DocSection>

          {/* Node SDK */}
          <DocSection id="sdk-node" title="Node SDK">
            <Code>{`npm i @secretforge/sdk`}</Code>
            <Code>{`import { config, load } from '@secretforge/sdk';

// Fetch secrets at boot and merge into process.env.
// Real environment variables always win over the vault.
await config();   // uses SECRETFORGE_TOKEN + .secretforge.json

// Or get a plain object without touching process.env:
const values = await load({ env: 'prod' });`}</Code>
            <Note>
              Options: <span className="mono">projectId</span>, <span className="mono">env</span>,{' '}
              <span className="mono">token</span>, <span className="mono">url</span> — all optional when the
              env vars / link file are present.
            </Note>
          </DocSection>

          {/* Python SDK */}
          <DocSection id="sdk-python" title="Python SDK">
            <Code>{`pip install secretforge   # stdlib only, Python 3.9+`}</Code>
            <Code>{`import secretforge

# Fetch secrets at boot and merge into os.environ.
# Real environment variables always win over the vault.
secretforge.config()   # uses SECRETFORGE_TOKEN + .secretforge.json

# Or get a plain dict without touching os.environ:
values = secretforge.load(env="prod")`}</Code>
            <Note>
              Options: <span className="mono">project_id</span>, <span className="mono">env</span>,{' '}
              <span className="mono">token</span>, <span className="mono">url</span> — all optional when the
              env vars / link file are present. Errors raise{' '}
              <span className="mono">secretforge.ForgeError</span> with the HTTP status.
            </Note>
          </DocSection>

          {/* CI */}
          <DocSection id="ci" title="CI integration">
            <P>
              1. Create a token for the environment your pipeline needs. 2. Store it as a CI secret named{' '}
              <span className="mono">SECRETFORGE_TOKEN</span>. 3. Run your commands through the CLI:
            </P>
            <Code>{`# GitHub Actions
- name: Tests with vault secrets
  env:
    SECRETFORGE_TOKEN: \${{ secrets.SECRETFORGE_TOKEN }}
  run: npx @secretforge/cli run --env prod -- npm test`}</Code>
          </DocSection>

          {/* Roles */}
          <DocSection id="roles" title="Roles & permissions">
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Capability</th>
                    <th>READ</th>
                    <th>WRITE</th>
                    <th>ADMIN</th>
                  </tr>
                </thead>
                <tbody>
                  <RoleRow cap="List / reveal / export secrets" read write admin />
                  <RoleRow cap="View version history" read write admin />
                  <RoleRow cap="Add / update secrets, bulk import" write admin />
                  <RoleRow cap="Delete secrets, roll back versions" admin />
                  <RoleRow cap="Manage members & roles" admin />
                  <RoleRow cap="Create / revoke service tokens" admin />
                  <RoleRow cap="Project settings, add environments, delete project" admin />
                </tbody>
              </table>
            </div>
            <Note>
              Org membership is separate: only org members can be added to a project. Roles are checked on
              every request, and denials are audited.
            </Note>
          </DocSection>

          {/* Security */}
          <DocSection id="security" title="Security model">
            <ul style={{ margin: 0, paddingLeft: 18, display: 'grid', gap: 8, fontSize: 13, color: 'var(--text-2)' }}>
              <li><strong>AES-256-GCM</strong> per secret value, unique IV per write.</li>
              <li><strong>Envelope encryption</strong>: each project has its own data key, wrapped by a master key that lives only in the server environment — never in the database or repo.</li>
              <li>Values are <strong>masked everywhere</strong>; every reveal and export is audited.</li>
              <li>Auth: argon2-hashed passwords, short-lived JWT access tokens + rotating refresh tokens.</li>
              <li>Service tokens are stored as SHA-256 hashes and are read-only by design.</li>
              <li>Login and secret-read endpoints are rate-limited.</li>
              <li>Every change is versioned — roll back any secret at any time.</li>
            </ul>
          </DocSection>

          {/* API reference */}
          <DocSection id="api" title="API reference">
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th style={{ width: 1 }}>Method</th>
                    <th>Endpoint</th>
                    <th>Description</th>
                  </tr>
                </thead>
                <tbody>
                  <ApiRow method="POST" path="/auth/signup · /auth/login · /auth/refresh · /auth/logout" desc="Auth lifecycle" />
                  <ApiRow method="GET" path="/auth/me" desc="Current user" />
                  <ApiRow method="POST" path="/orgs" desc="Create org · GET /orgs lists yours" />
                  <ApiRow method="POST" path="/projects" desc="Create project · GET /projects lists yours" />
                  <ApiRow method="PATCH" path="/projects/:id" desc="Rename (ADMIN) · DELETE removes (ADMIN)" />
                  <ApiRow method="POST" path="/projects/:id/envs" desc="Add environment (ADMIN)" />
                  <ApiRow method="GET" path="/projects/:id/envs/:env/secrets" desc="Masked list (READ)" />
                  <ApiRow method="PUT" path="/projects/:id/envs/:env/secrets/:key" desc="Upsert (WRITE) · DELETE (ADMIN)" />
                  <ApiRow method="GET" path="…/secrets/:key" desc="Reveal value (READ, audited)" />
                  <ApiRow method="GET" path="…/secrets/export · …/secrets/import" desc="Bulk .env export (READ) / import (WRITE)" />
                  <ApiRow method="GET" path="…/secrets/:key/versions" desc="History · POST …/versions/:v/rollback (ADMIN)" />
                  <ApiRow method="POST" path="/projects/:id/members" desc="Share by email + role (ADMIN)" />
                  <ApiRow method="POST" path="/projects/:id/envs/:env/tokens" desc="Create service token (ADMIN)" />
                  <ApiRow method="GET" path="/projects/:id/tokens" desc="List tokens · DELETE …/tokens/:id revokes (ADMIN)" />
                  <ApiRow method="GET" path="/audit?project=:id" desc="Audit log (filter, paginate)" />
                </tbody>
              </table>
            </div>
            <Note>
              All secrets endpoints accept either a user JWT or a read-only service token scoped to that
              environment.
            </Note>
          </DocSection>
        </main>
      </div>
    </div>
  );
}

function DocSection({ id, title, children }: { id: string; title: string; children: React.ReactNode }) {
  return (
    <section id={id} className="panel" style={{ scrollMarginTop: 64 }}>
      <div className="panel-header">
        <h2>{title}</h2>
      </div>
      <div className="panel-body" style={{ display: 'grid', gap: 12 }}>
        {children}
      </div>
    </section>
  );
}

function Code({ children }: { children: string }) {
  return <pre className="code-block mono">{children}</pre>;
}

function P({ children }: { children: React.ReactNode }) {
  return <p style={{ margin: 0, fontSize: 13, color: 'var(--text-2)', lineHeight: 1.6 }}>{children}</p>;
}

function Note({ children }: { children: React.ReactNode }) {
  return (
    <p style={{ margin: 0, fontSize: 12, color: 'var(--text-3)', lineHeight: 1.6 }}>{children}</p>
  );
}

function RoleRow({ cap, read, write, admin }: { cap: string; read?: boolean; write?: boolean; admin?: boolean }) {
  const mark = (on?: boolean) =>
    on ? (
      <span style={{ color: 'var(--ok)' }}>✓</span>
    ) : (
      <span style={{ color: 'var(--text-4)' }}>—</span>
    );
  return (
    <tr>
      <td style={{ color: 'var(--text-2)' }}>{cap}</td>
      <td>{mark(read)}</td>
      <td>{mark(write)}</td>
      <td>{mark(admin)}</td>
    </tr>
  );
}

function ApiRow({ method, path, desc }: { method: string; path: string; desc: string }) {
  return (
    <tr>
      <td>
        <span className="badge badge-accent" style={{ fontSize: 9 }}>
          {method}
        </span>
      </td>
      <td className="mono" style={{ fontSize: 12, color: 'var(--text-2)' }}>
        {path}
      </td>
      <td className="muted" style={{ fontSize: 12 }}>
        {desc}
      </td>
    </tr>
  );
}
