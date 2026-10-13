# SecretForge

Team secrets vault — centralized env var management with CLI/SDK injection.
No more `.env` files in repos, chats, or emails.

```
Web UI  ─┐
CLI     ─┼──► API (NestJS) ──► PostgreSQL (AES-256-GCM encrypted secrets)
SDK     ─┘        └──► Master key (env var) wraps per-project data keys
```

## Status

**Phases 1-6 complete** — foundation, secrets core, CLI, sharing/audit hardening, web UI, and service tokens + Node SDK for CI.

| Phase | Scope | Status |
|---|---|---|
| 1 | DB schema, auth, org/project CRUD | ✅ done |
| 2 | Secrets CRUD with encryption, versioning | ✅ done |
| 3 | CLI (`forge login/init/set/run/pull`) | ✅ done |
| 4 | Roles, sharing, invites, audit hardening | ✅ done |
| 5 | Web UI (Next.js, dark theme per wireframe) | ✅ done |
| 6 | Service tokens, Node + Python SDKs, CI integration | ✅ done |
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
npm run dev -w apps/api     # API on http://localhost:4000
npm run dev -w apps/web     # Web UI on http://localhost:3000
```

### Tests

```bash
npm test             # unit tests: crypto (20) + .env parser (18)
npm run test:e2e     # e2e: auth, roles, secrets lifecycle (53 tests, needs Postgres)
```

## API (Phase 1)

```
POST /auth/signup | /auth/login | /auth/refresh | /auth/logout
GET  /auth/me
GET  /auth/providers                # which social providers are configured
GET  /auth/google | /auth/github    # 302 to the provider consent screen
GET  /auth/:provider/callback       # issues a single-use exchange code
POST /auth/oauth/exchange           # code → access+refresh tokens

POST /orgs                          # creator becomes OWNER
GET  /orgs                          # your orgs
GET  /orgs/:orgId                   # members + projects (members only)
POST /orgs/:orgId/invite            # ADMIN+; returns single-use token (7 days)
POST /orgs/:orgId/invites/accept    # must be logged in as invited email
GET  /orgs/:orgId/invites           # ADMIN+
DEL  /orgs/:orgId/invites/:id       # ADMIN+
GET  /invites/:token                # public preview (org name, role, masked email)
POST /invites/accept                # token-only accept; backs the web /invite/<token> page
POST /orgs/:orgId/members/:userId/role   # OWNER rules enforced
DEL  /orgs/:orgId/members/:userId        # last-owner protected

POST /projects                      # creates dev/staging/prod + wrapped data key
GET  /projects                      # projects you're a member of
GET  /projects/:projectId           # never exposes wrappedDataKey
POST /projects/:projectId/members           # project ADMIN only
POST /projects/:projectId/members/:userId/role
DEL  /projects/:projectId/members/:userId    # self-removal allowed; last-admin protected

GET  /projects/:projectId/shareable-members   # org members not yet in project (ADMIN)

GET  /audit?project=<id>&action=<name>&since=<iso>&until=<iso>&limit=<n>&offset=<n>
     # → { entries, total }; scoped to the caller's orgs/projects

# Secrets (Phase 2) — role matrix: READ → list/reveal/export/versions,
#                       WRITE → + upsert/import, ADMIN → + delete/rollback
GET    /projects/:projectId/envs/:env/secrets                    # masked list (no values)
PUT    /projects/:projectId/envs/:env/secrets/:key              # upsert (new version each write)
GET    /projects/:projectId/envs/:env/secrets/:key               # reveal (audited, rate-limited)
DELETE /projects/:projectId/envs/:env/secrets/:key              # ADMIN
POST   /projects/:projectId/envs/:env/secrets/import            # bulk paste .env content
GET    /projects/:projectId/envs/:env/secrets/export            # all values (audited, rate-limited)
GET    /projects/:projectId/envs/:env/secrets/:key/versions     # history (metadata only)
POST   /projects/:projectId/envs/:env/secrets/:key/versions/:v/rollback  # ADMIN; rollback = new version
```

## Security model

- **Envelope encryption**: master key (env var only) wraps a per-project data key; the data key encrypts secret values (AES-256-GCM, unique IV per write). Losing the master key loses all secrets — back it up separately.
- **Auth**: argon2id password hashing, 15-min JWT access tokens, single-use hashed refresh tokens (replay revokes the session). Optional social sign-in (Google/GitHub) — provider-verified emails only; identities link to the existing account by email.
- **Roles**: checked on every request. Org: OWNER > ADMIN > MEMBER. Project: ADMIN > WRITE > READ.
- **Audit**: every mutation logged; secret values never appear in logs or audit meta (sanitized + enforced by tests). Reveals and exports are audited individually. Auth events (login/failed login/logout) and denied access attempts (with reason + IP) are recorded for alerting.
- **Sharing**: project admins can share by email (target must be an org member — no cross-org sharing).
- **Rate limits**: global 300 req/min; login 10/min; reveal 60/min; export 10/min.
- **Versioning**: every write creates an immutable version row; rollback copies an old version forward (history is append-only).

## Social sign-in (optional)

Google and/or GitHub sign-in can be enabled alongside email+password. A provider
is active only when both of its env vars are set (see `.env.example`); the login
page queries `GET /auth/providers` and hides buttons for unconfigured providers.

1. **Google**: Cloud Console → APIs & Services → Credentials → *Create OAuth client ID* (Web). Add authorized redirect URI `$API_PUBLIC_URL/auth/google/callback`. Copy the client ID/secret into `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`.
2. **GitHub**: Settings → Developer settings → OAuth Apps → *New OAuth App*. Authorization callback URL `$API_PUBLIC_URL/auth/github/callback`. Copy into `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET`.
3. Restart the API — the buttons appear on the login page automatically.

Flow: `GET /auth/:provider` 302s to the consent screen (single-use `state`,
10-min TTL, optional `?next=` post-login redirect) → the callback verifies the
code server-side, finds-or-creates the user (linking by provider-verified
email), and 302s to the web `/auth/callback` with a single-use, 60-second
exchange code (SHA-256-hashed at rest) → the page redeems it via
`POST /auth/oauth/exchange` for real tokens. Real tokens never appear in URLs,
browser history, or access logs. OAuth-only accounts have no password and can't
use password login/change-password until one is set.

## Web UI (Phase 5)

Next.js 14 App Router, dark theme matching the wireframe (`#0b0b0d` background,
blue `#3b82f6` accent, Tabler icons). Talks to the API through a same-origin
rewrite (`/api/*` → `http://localhost:4000/*`), so no CORS setup is needed.

```bash
npm run dev -w apps/web    # http://localhost:3000
npm run build -w apps/web   # production build
```

Screens:
- **Login / signup** — argon2id-backed auth, tokens auto-refresh on 401
- **Projects dashboard** — org/project grid, create org + project modals
- **Project overview** — stat cards, secrets-per-environment bars, recent activity
- **Secrets** — env tabs (dev/staging/prod), masked values, reveal (auto-hides
  after 30s), add/edit, `.env` import, copy-all export, delete; buttons
  role-gated by `yourRole` (ADMIN/WRITE/READ)
- **Members** — share by email from org members, role dropdowns, remove
- **Audit** — filterable, paginated table; denied attempts highlighted
- **Integrate** — copy-paste CLI/SDK snippets for the project

## The `forge` CLI (Phase 3)

```bash
cd packages/cli && npm run build
node packages/cli/dist/index.js --help   # or: npm i -g . && forge --help
```

```bash
forge login                          # stores tokens in ~/.secretforge (chmod 600)
forge whoami
forge init                           # interactive picker → writes .secretforge.json
forge set API_KEY=abc123 --env dev   # prompts hidden if value omitted
forge list --env dev                 # keys + versions only, never values
forge run --env dev -- npm run dev   # injects secrets into the child process env
forge pull --env dev --stdout        # escape hatch: print .env format
forge import .env --env dev          # migration helper: push an existing .env
forge logout
```

- `.secretforge.json` (project ID + default env only) is safe to commit.
- `forge run` fetches decrypted secrets over HTTPS and merges them into the
  child's environment — nothing is written to disk, and secrets override any
  stale local values.
- Env resolution: `--env` flag > `SECRETFORGE_ENV` > project default > `dev`.
- API URL: `SECRETFORGE_URL` env var (default `http://localhost:4000`).
- CI/servers: set `SECRETFORGE_TOKEN=sf_...` (service tokens — see below).

## Service tokens & Node SDK (Phase 6)

Service tokens are **read-only, scoped to one environment, expiring, and
revocable** — built for CI and servers. Only the SHA-256 hash is stored; the
plaintext `sf_...` token is shown once at creation.

```bash
# Manage in the web UI (Project → Tokens) or via the API:
POST   /projects/:id/envs/:env/tokens   { "name": "GH Actions", "expiresInDays": 30 }  (ADMIN)
GET    /projects/:id/tokens             # metadata list (READ)
DELETE /projects/:id/tokens/:tokenId    # revoke (ADMIN)
```

Use a token anywhere instead of user credentials:

```bash
# CLI — no `forge login` needed:
SECRETFORGE_TOKEN=sf_... forge run --env prod -- node server.js

# Node SDK — secrets merged into process.env at boot (real env vars win):
import { config } from '@secretforge/sdk';
await config();   // uses SECRETFORGE_TOKEN + .secretforge.json

# Python SDK — same, into os.environ:
import secretforge
secretforge.config()

# GitHub Actions:
- env:
    SECRETFORGE_TOKEN: ${{ secrets.SECRETFORGE_TOKEN }}
  run: npx @secretforge/cli run --env prod -- npm test
```

Token misuse (wrong env, write attempts, revoked/expired use) is audited with
`actorType: TOKEN` and the token name — never the token itself.

## Repo layout

```
apps/api          NestJS REST API + Prisma schema + tests
apps/web          Next.js web UI (dark theme per wireframe)
packages/cli      forge CLI (login/init/set/list/run/pull/import)
packages/sdk-node @secretforge/sdk — load()/config() for Node apps
packages/sdk-python secretforge — load()/config() for Python apps (stdlib only)
deploy/Caddyfile  HTTPS reverse proxy config
```

## Deploy (self-hosted)

```bash
# Set real values in .env, then:
docker compose up -d --build          # postgres + api
docker compose --profile tls up -d   # + Caddy HTTPS (set domain in deploy/Caddyfile)
```

Migrations apply automatically on container start. Back up Postgres **and** the master key (separately!).
