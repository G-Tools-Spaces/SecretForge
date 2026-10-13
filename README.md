# SecretForge

Team secrets vault — centralized env var management with CLI/SDK injection.
No more `.env` files in repos, chats, or emails.

```
Web UI  ─┐
CLI     ─┼──► API (NestJS) ──► PostgreSQL (AES-256-GCM encrypted secrets)
SDK     ─┘        └──► Master key (env var) wraps per-project data keys
```

## Status

**Phase 1 complete** — foundation: auth, orgs, projects, roles, audit log, envelope encryption.

| Phase | Scope | Status |
|---|---|---|
| 1 | DB schema, auth, org/project CRUD | ✅ done |
| 2 | Secrets CRUD with encryption, versioning | next |
| 3 | CLI (`forge login/init/set/run/pull`) | planned |
| 4 | Roles, sharing, invites, audit log UI | planned |
| 5 | Web UI (Next.js, dark theme per wireframe) | planned |
| 6 | SDKs, service tokens, CI integration | planned |
| 7 | Hardening: 2FA, rate limits, backups, docs | planned |

## Quick start

```bash
# 1. Configure
cp .env.example .env
#    Fill in: SECRETFORGE_MASTER_KEY (openssl rand -base64 32)
#             JWT_SECRET              (openssl rand -hex 32)

# 2. Database
docker compose up -d postgres

# 3. Install + migrate + run
npm install
npm run db:migrate
npm run dev          # API on http://localhost:4000
```

### Tests

```bash
npm test             # unit tests (crypto: 20 tests)
npm run test:e2e     # e2e: auth + role enforcement (26 tests, needs Postgres)
```

## API (Phase 1)

```
POST /auth/signup | /auth/login | /auth/refresh | /auth/logout
GET  /auth/me

POST /orgs                          # creator becomes OWNER
GET  /orgs                          # your orgs
GET  /orgs/:orgId                   # members + projects (members only)
POST /orgs/:orgId/invite            # ADMIN+; returns single-use token (7 days)
POST /orgs/:orgId/invites/accept    # must be logged in as invited email
GET  /orgs/:orgId/invites           # ADMIN+
DEL  /orgs/:orgId/invites/:id       # ADMIN+
POST /orgs/:orgId/members/:userId/role   # OWNER rules enforced
DEL  /orgs/:orgId/members/:userId        # last-owner protected

POST /projects                      # creates dev/staging/prod + wrapped data key
GET  /projects                      # projects you're a member of
GET  /projects/:projectId           # never exposes wrappedDataKey
POST /projects/:projectId/members           # project ADMIN only
POST /projects/:projectId/members/:userId/role
DEL  /projects/:projectId/members/:userId    # self-removal allowed; last-admin protected

GET  /audit?project=<id>&action=<name>&limit=<n>
```

## Security model

- **Envelope encryption**: master key (env var only) wraps a per-project data key; the data key encrypts secret values (AES-256-GCM, unique IV per write). Losing the master key loses all secrets — back it up separately.
- **Auth**: argon2id password hashing, 15-min JWT access tokens, single-use hashed refresh tokens (replay revokes the session).
- **Roles**: checked on every request. Org: OWNER > ADMIN > MEMBER. Project: ADMIN > WRITE > READ.
- **Audit**: every mutation logged; secret values never appear in logs or audit meta (sanitized + enforced by tests).
- **Rate limits**: global 300 req/min; login 10/min.

## Repo layout

```
apps/api          NestJS REST API + Prisma schema + tests
packages/cli      forge CLI (Phase 3)
packages/sdk-node (Phase 6)
packages/sdk-python (Phase 6)
deploy/Caddyfile  HTTPS reverse proxy config
```

## Deploy (self-hosted)

```bash
# Set real values in .env, then:
docker compose up -d --build          # postgres + api
docker compose --profile tls up -d   # + Caddy HTTPS (set domain in deploy/Caddyfile)
```

Migrations apply automatically on container start. Back up Postgres **and** the master key (separately!).
