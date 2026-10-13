# SecretForge: Team Env Vault

> Handoff document from a claude.ai planning chat. Read this fully before writing code.
> Suggested use: save as `CLAUDE.md` (or `docs/PLAN.md` and reference it from `CLAUDE.md`) in the repo root.

## Goal

A centralised secrets vault for a team of 3-4 developers working on multiple projects. Users create projects, add env vars and values, and share access with other org members. Secrets are injected into apps via CLI/SDK so `.env` files are no longer needed.

## Naming conventions

| Item | Name |
|---|---|
| Product | SecretForge |
| CLI binary | `forge` (alias `secretforge`) |
| Project link file | `.secretforge.json` (safe to commit; only project ID + default env) |
| Service token env var | `SECRETFORGE_TOKEN` (tokens prefixed `sf_`) |
| API URL env var | `SECRETFORGE_URL` |
| Node SDK | `@secretforge/sdk` |
| Python SDK | `secretforge` |
| Docker images | `secretforge-api`, `secretforge-web` |

## Repo layout (monorepo)

```
secretforge/
  apps/api            # REST API
  apps/web            # Next.js UI
  packages/cli        # forge CLI
  packages/sdk-node
  packages/sdk-python
```

## Suggested stack (confirm with the developer before starting)

Next.js (UI), Node (NestJS/Express) or Go (API), PostgreSQL, Docker Compose, Caddy/Nginx for HTTPS. CLI in Node (simplest) or Go (single binary).

## MVP features

- Orgs with members (invite by email)
- Projects inside an org
- Environments per project (dev / staging / prod)
- Secrets (key + value) per environment
- Per-project sharing with roles (admin / write / read)
- CLI and SDK to fetch/inject secrets
- Audit log of reads and changes

## Architecture

```
Web UI  ─┐
CLI     ─┼──► API Server (REST) ──► PostgreSQL (encrypted secrets)
SDK     ─┘          └──► KMS / master key (encrypts data keys)
```

## Data model

| Table | Key fields |
|---|---|
| users | id, email, password_hash (or OAuth id), created_at |
| organizations | id, name |
| org_members | org_id, user_id, role (owner/admin/member) |
| projects | id, org_id, name, slug |
| project_members | project_id, user_id, role (admin/write/read) |
| environments | id, project_id, name |
| secrets | id, env_id, key, encrypted_value, iv, version, updated_by |
| secret_versions | secret_id, encrypted_value, version, changed_by, changed_at |
| service_tokens | id, env_id, hashed_token, scope (read), expires_at |
| audit_logs | id, user_id, action, resource, ip, timestamp |
| cli_sessions | id, user_id, hashed_refresh_token, device |

## Security requirements (highest priority)

1. AES-256-GCM per value, unique IV each time.
2. Envelope encryption: per-project data key, encrypted by a master key from cloud KMS (or at minimum an env var/file never stored in the DB or repo).
3. HTTPS only.
4. Auth: argon2 password hashing + TOTP 2FA, or Google/GitHub OAuth. Short-lived JWT access tokens + refresh tokens.
5. Check role on every request. Consider extra confirmation/approval for prod.
6. Never log secret values. Mask in UI; the reveal action is audited.
7. Service tokens for CI/servers: read-only, scoped to one environment, revocable, expiring.
8. Rate limit login and secret-read endpoints.
9. Version secrets so changes can be rolled back.

## API endpoints

```
POST   /auth/signup | /auth/login | /auth/refresh
POST   /orgs                         POST /orgs/:id/invite
POST   /projects                     GET  /projects
POST   /projects/:id/members         (share access, set role)
GET    /projects/:id/envs/:env/secrets
PUT    /projects/:id/envs/:env/secrets/:key
DELETE /projects/:id/envs/:env/secrets/:key
POST   /tokens                       (create service token)
GET    /audit?project=...
```

## CLI (replaces `.env`)

```bash
forge login                          # browser or device-code login
forge init                           # creates .secretforge.json
forge set API_KEY=abc123 --env dev
forge list --env dev
forge run --env dev -- npm run dev   # injects secrets into child process env
forge pull --env dev > .env          # optional escape hatch
```

`forge run` fetches decrypted secrets over HTTPS, then spawns the command with those variables merged into its environment. Nothing is written to disk.

## SDKs and other injection methods

- Node: `await forge.config({ project: "my-app", env: "dev" })` populates `process.env`; also `forge.load()`.
- Python: equivalent `secretforge.load()`.
- Docker/CI: `SECRETFORGE_TOKEN=sf_xxx forge run --env prod -- node server.js`; optionally a small GitHub Action.
- Optional short-lived encrypted local cache for brief offline periods.

## Web UI screens

Login, org dashboard, project list, project page (env tabs, masked secrets table, add/edit/delete, bulk paste of `.env`), members & roles, tokens, audit log, `.env` import/export.

## Phases

| Phase | Scope | Time |
|---|---|---|
| 1 | DB schema, auth, org/project CRUD | 1 wk |
| 2 | Secrets CRUD with encryption, versioning | 1 wk |
| 3 | CLI (`login`, `init`, `set`, `run`, `pull`) | 1 wk |
| 4 | Roles, sharing, invites, audit log | 1 wk |
| 5 | Web UI | 1-2 wk |
| 6 | SDKs, service tokens, CI integration | 1 wk |
| 7 | Hardening: 2FA, rate limits, backups, docs | 1 wk |

Phases 1-4 are the MVP and are enough to drop `.env` files.

## Operations

- Host on a small VPS/cloud container with Docker Compose behind HTTPS.
- Automated encrypted Postgres backups. Back up the master key separately (losing it loses all secrets).
- Alert on failed logins and unusual bulk reads.
- Migration: import existing `.env` files, then rotate any secrets previously shared over chat/email.

## Risks

- Master key is a single point of failure: plan backup and rotation.
- If the vault is down, nobody can run projects: provide a cache or `pull` fallback.
- Secrets in process env can leak via crash dumps/logs: never print `process.env`.

## Instructions for Claude Code

1. Ask the developer to confirm the stack (language for API/CLI, self-host vs cloud) before scaffolding.
2. Start with Phase 1: monorepo scaffold, Postgres schema + migrations, auth, org/project CRUD.
3. Work phase by phase; write tests for the encryption and authorization logic first.
4. Never commit real secrets; use placeholder values in examples and tests.
