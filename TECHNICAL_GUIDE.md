# SecretForge — Complete Technical File Guide

A file-by-file explanation of the entire repository: what each file does, how it works, and how it fits into the whole.

---

## 1. The Big Picture

**SecretForge** is a self-hosted team secrets vault (a `.env` replacement). It stores environment variables encrypted at rest and injects them into apps at runtime via a CLI and SDKs, so plaintext `.env` files never need to exist on disk or in chat.

**Monorepo layout** (npm workspaces — `apps/*`, `packages/*`):

| Piece | Path | Stack | Runs as |
|---|---|---|---|
| API | `apps/api` | NestJS 10 + Prisma 6 + PostgreSQL | Node server on :4000 |
| Web UI | `apps/web` | Next.js 14 (App Router) | Node server on :3000 |
| CLI | `packages/cli` | TypeScript + commander | `forge` binary on npm (`@gtools-spaces/cli`) |
| Node SDK | `packages/sdk-node` | TypeScript, zero deps | library (not published) |
| Python SDK | `packages/sdk-python` | stdlib-only Python | library on PyPI (`secretforge`) |

**The security model in one paragraph:**
Secret *values* are encrypted with AES-256-GCM using a **per-project data key** (DEK). Each DEK is itself encrypted ("wrapped") by a **master key** that exists only in the API's environment (`SECRETFORGE_MASTER_KEY`) — never in the database. This is *envelope encryption*: the DB alone is useless to an attacker, and each project is cryptographically isolated. Passwords are hashed with argon2id; refresh tokens, service tokens, OAuth exchange codes and CLI auth codes are all stored only as SHA-256 hashes; every sensitive action is written to an append-only audit log that is defensively sanitized so secret values can never leak into it.

**Data flow for the core use case (`forge run -- npm start`):**
```
CLI → GET /projects/:id/envs/dev/secrets/export  (Bearer JWT or sf_ service token)
    → API: CombinedAuthGuard (JWT or service token) → ProjectRoleGuard (READ)
    → SecretsService.export(): unwrap project DEK with master key,
      AES-256-GCM-decrypt each row, audit SECRET_READ
    → CLI merges values over process.env and spawns the child process
```

---

## 2. Root Files

| File | Purpose |
|---|---|
| `package.json` | Workspace root. Scripts delegate to `apps/api`: `dev`, `build`, `start`, `test`, `test:e2e`, plus Prisma helpers (`db:generate`, `db:migrate`, `db:deploy`, `db:studio`) that point at `apps/api/prisma/schema.prisma`. Only devDependency is Prettier. |
| `package-lock.json` | Lockfile for the whole workspace tree (hoisted `node_modules` at root). |
| `tsconfig.base.json` | Shared TypeScript defaults (strict, ES2022, NodeNext-style resolution) extended by each app/package tsconfig. |
| `.prettierrc` | Formatting rules (single quotes, 100-col, trailing commas). |
| `.gitignore` | Ignores `node_modules`, `dist`, `.env`, `.next`, `__pycache__`, etc. |
| `.dockerignore` | Keeps the Docker build context small (excludes `node_modules`, `.env`, web `.next`). |
| `.env.example` | Template for the API environment: `DATABASE_URL`, `SECRETFORGE_MASTER_KEY` (base64 32 bytes), `JWT_SECRET`, token TTLs, `WEB_ORIGIN`, `API_PUBLIC_URL`, optional Google/GitHub OAuth client credentials. Copied to `.env` for local dev. |
| `docker-compose.yml` | Local dev / small-team stack: `postgres` (Postgres 16, healthchecked), `api` (built from `apps/api/Dockerfile`, waits for healthy DB, overrides `DATABASE_URL` to the compose network host `postgres`), and an optional `caddy` service under the `tls` profile for HTTPS. |
| `render.yaml` | Render.com blueprint for the API: build with dev deps included (`npm ci --include=dev && npm run build`), start with `npm run db:deploy && node apps/api/dist/main.js`, health check on `/auth/providers`, and every secret env var marked `sync: false` (entered once in the dashboard, never in git). |
| `README.md` | Project intro and quickstart. |
| `DEPLOY.md` | Full deployment walkthrough (Render API + Vercel web + Neon Postgres). |
| `GUIDELINES.md` | Contributor/operator handbook: architecture rules, security requirements, release steps, CLI/SDK usage. |
| `SECRETFORGE_PLAN.md` | The original build plan/wireframe the implementation was driven from (phases, security requirements M1–M8). |

---

## 3. `apps/api` — The NestJS Backend

### 3.1 Config & bootstrap

- **`apps/api/package.json`** — API manifest (`@gtools-spaces/api`). Scripts: `dev` (nest watch), `build` (nest build → `dist/`), `start` (node dist/main), `test` (Jest unit), `test:e2e` (Jest e2e against a real Postgres). Key deps: `@nestjs/*` 10, `@prisma/client`, `@node-rs/argon2` (memory-hard password hashing), `@nestjs/jwt` + `passport-jwt`, `@nestjs/throttler` (rate limiting), `helmet`, `zod` (env validation), `class-validator`/`class-transformer` (DTO validation).
- **`apps/api/nest-cli.json`** — Nest CLI config (source root `src`, output `dist`).
- **`apps/api/tsconfig.json` / `tsconfig.build.json`** — Extends the base config; build variant excludes tests/specs.
- **`apps/api/Dockerfile`** — Two-stage build. Stage 1 (`node:20-alpine`): copy manifests → `npm install` → copy source → `prisma generate` → `nest build`. Stage 2: copy only `node_modules`, `dist`, `prisma` → `CMD` runs `prisma migrate deploy` then boots the server. No secrets are baked into the image.
- **`apps/api/.env.e2e`** — Test overrides loaded by `setup-e2e.ts` (points `DATABASE_URL`/`DIRECT_URL` at the local docker `secretforge_test` database so e2e never touches dev/prod data).

- **`src/main.ts`** — Process entry point.
  1. Loads `.env` from three candidate locations (CWD, repo root relative to `dist/main.js` and `dist/src/main.js`) so `npm run dev` works from anywhere in the monorepo.
  2. Creates the Nest app on the Express platform, then:
     - `helmet()` — security headers.
     - `enableCors({ origin: WEB_ORIGIN (comma-split), credentials: true })` — only the web app may call the API with cookies.
     - Global `ValidationPipe({ whitelist, forbidNonWhitelisted, transform })` — strips unknown body fields and rejects them outright; types are coerced.
     - `app.set('trust proxy', 1)` — so `req.ip` is the real client IP behind Caddy/Render (used by rate limiting and audit).
     - `enableShutdownHooks()` — lets Prisma disconnect cleanly on SIGTERM.
  3. Listens on `env.port` (default 4000).

- **`src/app.module.ts`** — Root module. Registers `ThrottlerModule.forRoot([{ ttl: 60s, limit: 300 }])` (global rate limit) and applies `ThrottlerGuard` as an `APP_GUARD` so *every* route is throttled by default; sensitive routes add stricter per-route limits with `@Throttle`. Imports ConfigModule, PrismaModule, CryptoModule (all global), then the feature modules: Auth, Orgs, Projects, Secrets, Tokens, Audit.

- **`src/config/config.module.ts`** — `@Global()` module providing `EnvService` everywhere without re-importing.
- **`src/config/env.service.ts`** — Validated, typed environment. A zod schema (`EnvSchema`) parses `process.env` at boot; the process **refuses to start** if `DATABASE_URL`, `SECRETFORGE_MASTER_KEY`, or a ≥32-char `JWT_SECRET` is missing/malformed — fail-fast beats running a vault with a weak key. Exposes typed getters (`port`, `masterKey`, `jwtSecret`, `webOrigin`, `apiPublicUrl`, OAuth client ids/secrets) and computed `googleEnabled`/`githubEnabled` (a provider is on only when *both* its values exist).

- **`src/prisma/prisma.module.ts`** — `@Global()` module exporting `PrismaService`.
- **`src/prisma/prisma.service.ts`** — `PrismaService extends PrismaClient` with `onModuleInit` → `$connect()` and `onModuleDestroy` → `$disconnect()` (ties the DB pool to Nest's lifecycle).

### 3.2 Database — `prisma/schema.prisma` + migrations

**`prisma/schema.prisma`** — The full data model (PostgreSQL; `url` = pooled runtime connection, `directUrl` = unpooled endpoint for Neon migrations). Models:

- **`User`** — `email` (unique), `name`, `passwordHash` (**null for OAuth-only accounts** — this is why browser CLI login exists), `totpSecret` (TOTP secret AES-256-GCM-encrypted with the *master key*, stored `"ct.iv.tag"`), `totpEnabled`.
- **`OAuthAccount`** — A linked social identity: `(provider, providerAccountId)` unique per user; cascade-deletes with the user.
- **`OAuthState`** — DB-backed OAuth `state` values (login-CSRF protection): single-use, 10-min TTL, indexed on `expiresAt`. Persisted so the flow survives restarts and works across multiple API instances.
- **`OAuthExchangeCode`** — Single-use code handed to the browser after a successful social callback; the web `/auth/callback` page redeems it for real tokens so tokens never appear in URLs/history/logs. SHA-256 hashed, 60-second TTL. `pendingTotpUserId` marks codes that can't be redeemed until a TOTP code is presented (2FA on social sign-in).
- **`CliAuthCode`** — Same pattern for browser-based `forge login`: minted by the web `/cli-auth` approve page, redeemed by the CLI. SHA-256 hashed, single-use, 5-minute TTL (long enough to paste manually on headless machines).
- **`Organization` / `OrgMember` / `OrgInvite`** — Orgs have unique slugs; members have roles `OWNER | ADMIN | MEMBER` (unique per `(orgId, userId)`); invites are single-use tokens (7-day expiry, unique per `(orgId, email)`).
- **`Project`** — Belongs to an org, unique `(orgId, slug)`. `wrappedDataKey` = the project's DEK encrypted by the master key. `ipAllowlist` reserved for the wireframe's "Allowed IPs" page.
- **`ProjectMember`** — Per-project roles `ADMIN | WRITE | READ`, unique per `(projectId, userId)`.
- **`Environment`** — Named env within a project (`dev`/`staging`/`prod` by default, custom allowed), unique `(projectId, name)`.
- **`Secret`** — The vault row: `environmentId + group + key` unique. `group` is an optional namespace inside an env (e.g. `frontend`, `backend`; `""` = ungrouped). `encryptedValue`/`iv`/`authTag` are the AES-256-GCM parts (base64). `version` increments on every write; `rotatedAt` tracks last rotation.
- **`SecretVersion`** — Immutable history: every write (and rollback) appends a row with the full ciphertext for that version, unique `(secretId, version)`.
- **`ServiceToken`** — CI/server token: only the SHA-256 `hashedToken` is stored; `tokenPrefix` (first ~10 chars) is kept for display; scoped to ONE environment; `expiresAt`, `revokedAt`, `lastUsedAt`, optional `ipAllowlist`.
- **`Session`** — A refresh-token session: `hashedRefreshToken` (SHA-256, unique), device label, IP, expiry, revocation.
- **`AuditLog`** — Append-only event log: `actorType` (`USER|TOKEN|SYSTEM`), nullable `userId` (SetNull on user delete), `orgId`/`projectId` (**plain strings, no FK** — audit entries deliberately survive project deletion), `action`, `resource` (e.g. `project/<id>/env/prod/secret/STRIPE_KEY`), `ip`, sanitized `meta` JSON. Indexed for the audit page's filters.

**`prisma/migrations/`** — Seven applied migrations, each a folder with `migration.sql`, plus `migration_lock.toml` (provider pin):
1. `20261013114818_init` — base schema (users, orgs, projects, envs, secrets, versions, sessions, audit).
2. `20261013133610_service_token_prefix` — adds `ServiceToken.tokenPrefix` for UI display.
3. `20261013172202_oauth_accounts` — adds `OAuthAccount`.
4. `20261014080933_oauth_state_totp` — adds `OAuthState` and the user's TOTP columns.
5. `20261014120000_secret_group` — adds `Secret.group` and re-keys the unique constraint to `(environmentId, group, key)`.
6. `20261014161300_oauth_exchange_totp` — adds `OAuthExchangeCode.pendingTotpUserId` (2FA gate on social sign-in).
7. `20261014170500_cli_auth_code` — adds `CliAuthCode` (browser CLI login).

### 3.3 Crypto module — envelope encryption

- **`src/crypto/master-key.service.ts`** — Loads the master key from `SECRETFORGE_MASTER_KEY` (base64, must decode to exactly 32 bytes) and exposes it as a `Buffer`. Throws at boot if missing/wrong length. This key is the root of the entire hierarchy and never touches the DB.
- **`src/crypto/envelope-encryption.service.ts`** — The crypto core:
  - `generateWrappedDataKey()` — creates a random 32-byte project DEK, encrypts it with the master key, returns `"ct.iv.tag"` for `Project.wrappedDataKey`. The plaintext DEK never persists.
  - `unwrapDataKey(wrapped)` — decrypts a project's DEK on demand.
  - `encryptWithKey(key, plaintext)` / `decryptWithKey(...)` — AES-256-GCM with a fresh random 96-bit IV per encryption (same value encrypted twice yields different ciphertext; tampering is caught by the GCM auth tag).
- **`src/crypto/crypto.module.ts`** — `@Global()` module; builds `MasterKeyService` via a factory injected with `EnvService`, exports both services.
- **`src/crypto/envelope-encryption.service.spec.ts`** — Unit tests: round-trip encrypt/decrypt, unique IVs, auth-tag tamper rejection, key-length validation.

### 3.4 Auth module — identity, sessions, 2FA, OAuth, CLI login

- **`src/auth/auth.module.ts`** — Wires Passport + `JwtModule.registerAsync` (secret + TTL from `EnvService`), imports `forwardRef(() => AuditModule)` to break the Auth⇄Audit dependency cycle, registers `AuthController` + `OAuthController`, provides `AuthService`, `OAuthService`, `JwtStrategy`, `TotpService`.

- **`src/auth/auth.service.ts`** — Password auth and token lifecycle:
  - `issueTokens(userId, email, device, ip)` — mints a JWT access token (default 15 min, payload `{sub, email}`) and an opaque 48-byte refresh token; only the refresh token's **SHA-256 hash** is stored as a `Session` row. Public so `OAuthService` and the CLI exchange can reuse it.
  - `signup(dto, ip)` — rejects duplicate emails (409), hashes the password with **argon2id**, creates the user, issues tokens, audits `USER_SIGNUP`.
  - `login(dto, ip)` — constant-timing defense: runs an argon2 `verify` even when the user doesn't exist (dummy hash) to prevent user enumeration. On failure audits `USER_LOGIN_FAILED` (no userId, email in the resource path, never the password). **2FA gate:** if `totpEnabled` and no `totpCode`, throws 401 `{ totp_required: true }` with *no tokens*; a wrong code is audited and also 401s. Success issues tokens and audits `USER_LOGIN`.
  - `refresh(refreshToken, ip)` — **single-use rotation**: looks up the session by hash, rejects revoked/expired, immediately marks the old row revoked, and issues a fresh pair. A replayed (already-rotated) token therefore can't be used twice — theft is detectable.
  - `changePassword(userId, dto, currentRefreshToken, ip)` — verifies the current password (OAuth-only accounts get a clear 400), rehashes, then **revokes every other session** except the caller's — a stolen session can't survive a password change.
  - `updateProfile`, `logout` (revokes the presented refresh token's session; audits `USER_LOGOUT`).

- **`src/auth/auth.controller.ts`** — HTTP surface for the above, all under `/auth`:
  - `POST /auth/signup`, `POST /auth/login` (throttled 10/min), `POST /auth/refresh` (30/min; prefers the httpOnly cookie, falls back to body for the CLI), `POST /auth/logout` (204).
  - Each token-issuing route also calls `setRefreshCookie` so browsers get the refresh token as an httpOnly cookie.
  - TOTP management: `POST /auth/totp/setup` → `POST /auth/totp/enable` → `POST /auth/totp/disable` → `GET /auth/totp/status` (all JWT-guarded, throttled).
  - **Browser CLI login** (the newest addition):
    - `GET /auth/cli/start?port&state` — validates the localhost port (1–65535) and hex `state`, then 302s to `WEB_ORIGIN/cli-auth?port&state`.
    - `POST /auth/cli/authorize` (JWT guard, 10/min) — mints a 32-byte single-use code, stores its SHA-256 with a 5-min TTL in `CliAuthCode`, returns the plaintext to the web page.
    - `POST /auth/cli/exchange` (10/min) — looks up the code hash, rejects missing/consumed/expired, marks it consumed, issues a token pair via `issueTokens(..., 'cli', ip)`, audits `USER_LOGIN` with `meta.device = 'cli'`, sets the refresh cookie, returns tokens + user.
  - `GET /auth/me`, `PATCH /auth/me` (rename), `POST /auth/change-password` (JWT-guarded).

- **`src/auth/dto.ts`** — class-validator DTOs: `SignupDto` (email, ≥10-char password, optional name), `LoginDto` (+ optional `totpCode`), `RefreshDto`, `LogoutDto`, `UpdateProfileDto`, `OAuthExchangeDto` (code + optional `totpCode`), `CliExchangeDto`, `TotpCodeDto` (6–10 chars), `ChangePasswordDto` (current + new ≥10 chars + optional `refreshToken` to keep the current session alive).

- **`src/auth/jwt-payload.ts`** — Types: `JwtPayload { sub, email }` and `AuthedUser { id, email, name }`.
- **`src/auth/jwt.strategy.ts`** — Passport JWT strategy: extracts `Bearer` tokens, verifies signature + expiry against `JWT_SECRET`, and `validate()` maps the payload to `{ id, email }` on `request.user`. (Session revocation is only checked on `/auth/refresh` — access tokens are short-lived by design.)
- **`src/auth/jwt-auth.guard.ts`** — `JwtAuthGuard extends AuthGuard('jwt')` — the one-liner guard used on all user-authenticated routes.
- **`src/auth/current-user.decorator.ts`** — `@CurrentUser()` param decorator returning `request.user`.

- **`src/auth/cookies.ts`** — Refresh-cookie helpers (review item M5): `sf_refresh` cookie with `httpOnly` (invisible to JS/XSS), `SameSite=Strict` (no cross-site sending → CSRF-safe), `Secure` in production, `path: '/'` (must match the web app's `/api/*` proxy paths). Includes a dependency-free `readCookie` parser and `setRefreshCookie`/`clearRefreshCookie`.

- **`src/auth/oauth.controller.ts`** — Social sign-in routes (public):
  - `GET /auth/providers` — which providers are configured (the login page shows/hides buttons).
  - `GET /auth/:provider(google|github)` — 302 to the provider consent screen; `?next=` is sanitized by `safeNext()` (same-origin absolute paths only — blocks `//evil.com`).
  - `GET /auth/:provider/callback` — consumes the DB state, exchanges the provider code server-side, then 302s to `WEB_ORIGIN/auth/callback?code=<exchangeCode>` (or `?error=…`).
  - `POST /auth/oauth/exchange` (10/min) — redeems the single-use code for real tokens (with the TOTP gate), sets the refresh cookie.

- **`src/auth/oauth.service.ts`** — The OAuth engine, zero extra dependencies (plain authorization-code flow over `fetch`):
  - `authorizeUrl(provider, next)` — stores a random 24-byte `state` in `OAuthState` (10-min TTL, opportunistic cleanup of expired rows), builds the Google/GitHub consent URL with the correct scopes.
  - `consumeState(state)` — **atomic single-use**: read + delete inside a transaction; rejects expired/unknown states.
  - `handleCallback(provider, code, ip)` — exchanges the provider code for a profile (`fetchGoogleProfile` hits `oauth2.googleapis.com/token` + `userinfo`; `fetchGithubProfile` hits `login/oauth/access_token` + `api.github.com/user`, falling back to `/user/emails` for a *verified* address), finds/creates the local user, then mints the 60-second exchange code — with `pendingTotpUserId` set when the account has 2FA.
  - `exchange(code, ip, totpCode?)` — validates the code hash; if `pendingTotpUserId` is set, the code stays **unconsumed** until a valid TOTP is presented (so users can retry within the 60s TTL); then consumes it, issues tokens via `AuthService.issueTokens(..., 'oauth', ip)`, audits `USER_LOGIN`.
  - `findOrCreateUser(...)` — resolution order: existing identity link → existing user with the same verified email (auto-links the identity) → brand-new user with `passwordHash: null` (OAuth-only account). Emails are only trusted when the provider marks them verified.

- **`src/auth/totp.ts`** — Dependency-free RFC 6238/4226 implementation: base32 encode/decode, `generateTotpSecret()` (160-bit), `hotp()` (HMAC-SHA-1, dynamic truncation, 6 digits), `verifyTotp()` with a ±1-step (30s) clock-skew window and a constant-time string compare, and `otpauthUrl()` for authenticator apps.
- **`src/auth/totp.service.ts`** — TOTP lifecycle: the secret is encrypted with the **master key** (not a project DEK — user secrets are a different branch) before storage. `startSetup` stores it disabled; `enable` requires a valid code before flipping `totpEnabled` (proves the user scanned it); `disable` also requires a current code; `verifyLogin` is the login-time check (returns `true` when 2FA is off). All state changes are audited.
- **`src/auth/totp.spec.ts`** — Unit tests for the RFC vectors (known HOTP/TOTP values), base32 round-trip, drift window, malformed codes.

### 3.5 Orgs module

- **`src/orgs/orgs.service.ts`** — Organization logic:
  - `slugify()` (exported, reused by projects) and `maskEmail()` (`b**@example.com` for public invite previews).
  - `create` (creator becomes OWNER, slug collisions get numeric suffixes), `update` (rename, OWNER/ADMIN only), `listForUser`, `get`.
  - `requireMembership` / `requireAdmin` — shared authorization assertions used by other modules too.
  - Invites: `invite` (rejects existing members and live pending invites, replaces stale ones, mints a 24-byte token valid 7 days; **no mailer** — the token is returned once so the inviter shares the `/invite/<token>` link manually), `getInviteByToken` (public preview leaking only org name, role, masked email), `acceptInvite` (must be logged in as the invited email; transaction creates the membership + marks accepted), `listInvites`, `revokeInvite`.
  - Member management: `updateMemberRole` (only OWNERs can grant OWNER; can't demote the last owner), `removeMember` (can't remove the last owner; only an owner can remove another owner). Everything audited.
- **`src/orgs/orgs.controller.ts`** — JWT-guarded `/orgs` routes: CRUD, invite create/accept/list/revoke, member role change and removal.
- **`src/orgs/invites.controller.ts`** — Token-based endpoints for the web invite page: `GET /invites/:token` (public preview, throttled 30/min) and `POST /invites/accept` (JWT-guarded, 20/min).
- **`src/orgs/dto.ts`** — `CreateOrgDto`, `UpdateOrgDto`, `InviteMemberDto` (role limited to ADMIN|MEMBER — you can't invite someone as OWNER), `UpdateMemberRoleDto`, `AcceptInviteDto`, `RemoveMemberDto`.
- **`src/orgs/orgs.module.ts`** — Registers both controllers, exports `OrgsService` (used by ProjectsService).

### 3.6 Projects module

- **`src/projects/projects.service.ts`** —
  - `create(userId, orgId, dto, ip)` — verifies org membership, generates a unique slug, **generates the project's wrapped data key**, creates the project with default `dev`/`staging`/`prod` environments and the creator as ADMIN — all in one Prisma create. The response strips `wrappedDataKey` (never exposed).
  - `listForUser`, `get` (includes `yourRole`), `update` (rename), `addEnvironment` (validates the env-name slug, rejects duplicates), `remove` (deletes the project; everything cascades except audit logs, which survive by design).
  - Membership: `addMember` (ADMIN only; resolve by userId or email; **target must already be an org member** — no cross-org sharing), `shareableOrgMembers` (org members not yet in the project — the share dialog's picker), `updateMemberRole`, `removeMember` (self-removal allowed; removing others needs ADMIN; **the last admin can never be removed**).
- **`src/projects/projects.controller.ts`** — `/projects` routes. Base guard is `JwtAuthGuard`; mutating/member routes add `ProjectRoleGuard` + `@MinProjectRole(...)` (ADMIN for update/delete/envs/members, READ for self-removal).
- **`src/projects/project-role.decorator.ts`** — `ProjectRole` type, `ROLE_RANK` (READ=1 < WRITE=2 < ADMIN=3), and `@MinProjectRole(role)` metadata decorator.
- **`src/projects/project-role.guard.ts`** — The RBAC enforcer (security req #5: check role on *every* request). Reads the required role from metadata, then:
  - **Service-token requests** (attached by `CombinedAuthGuard`): allowed only for READ routes; anything else is audited `ACCESS_DENIED` (`token_write_attempt`) and 403s — tokens are read-only by design.
  - **User requests**: loads the `ProjectMember` row; non-members get a plain 403 (doesn't leak project existence) and an audited `ACCESS_DENIED` (`not_a_member`); insufficient rank is audited (`insufficient_role`) and 403s. On success attaches `request.projectRole`.
- **`src/projects/project-role-param.decorator.ts`** — `@ProjectRoleParam()` extracts the role the guard attached (used by member-management routes for finer logic).
- **`src/projects/dto.ts`** — `CreateProjectDto` (orgId, name, optional creatorRole), `AddProjectMemberDto` (userId *or* email + role), `UpdateProjectMemberRoleDto`, `UpdateProjectDto`, `AddEnvironmentDto`.
- **`src/projects/projects.module.ts`** — Provides `ProjectsService` + `ProjectRoleGuard` (the guard is imported by Secrets/Tokens modules too).

### 3.7 Secrets module — the vault core

- **`src/secrets/secrets.service.ts`** — All secret operations:
  - Helpers: `resolveEnv` (validates the env name, 404s unknown envs), `normGroup` (validates optional group slugs), `projectDek` (unwraps the project's data key via the master key).
  - `list` — masked listing: keys, groups, versions, timestamps — **never values**.
  - `upsert` — validates the key (`[A-Za-z_][A-Za-z0-9_]*`), encrypts the value with the project DEK, then in a transaction creates or updates the `Secret` row **and appends an immutable `SecretVersion`** (version = previous + 1). Audits `SECRET_CREATED`/`SECRET_UPDATED`.
  - `reveal` — decrypts one secret; decryption failure (wrong master key or tampering) throws a generic 403 that doesn't reveal which. Every reveal is audited `SECRET_REVEALED` with the actor (user or token name).
  - `remove` — deletes the secret (versions cascade); audited.
  - `bulkImport` — parses pasted `.env` content via `parseEnvContent`, rejects invalid lines, upserts each key, reports created/updated counts.
  - `export` — decrypts **all** secrets in an env (optionally one group) into a `values` map; audited as a bulk `SECRET_READ` with count. This is the endpoint the CLI/SDKs call.
  - `versions` — metadata-only history for one secret.
  - `rollback` — copies an old version's ciphertext into a **new** version (history stays append-only; a rollback is itself a new version), audited `SECRET_VERSION_ROLLED_BACK`.
- **`src/secrets/secrets.controller.ts`** — Routes under `/projects/:projectId/envs/:env`, guarded by `CombinedAuthGuard` (user JWT **or** service token) + `ProjectRoleGuard`. Role matrix: READ → list/reveal/export/versions; WRITE → upsert/import; ADMIN → delete/rollback. `export` is throttled to 10/min, `reveal` to 60/min. `actorOf(req)` builds the audit actor (TOKEN when a service token authenticated, else USER).
- **`src/secrets/env-format.ts`** — Shared validation + `.env` parsing: key/env/group patterns, and `parseEnvContent` — a real parser handling `export ` prefixes, comments, first-`=` splitting, single/double quotes (double quotes get JSON escape semantics), and **multi-line quoted values** (pasted PEM keys). `formatEnvContent` serializes back round-trip-safe (JSON-stringifies values with newlines/leading quotes).
- **`src/secrets/env-format.spec.ts`** — Unit tests for the parser: quoting, multi-line values, comments, invalid keys, round-tripping.
- **`src/secrets/dto.ts`** — `UpsertSecretDto` (1 B–64 KB value), `BulkImportDto` (≤1 MB content).
- **`src/secrets/secrets.module.ts`** — Imports Auth/Audit/Projects/Tokens modules (for guards), provides `SecretsService`.

### 3.8 Tokens module — service tokens for CI

- **`src/tokens/tokens.service.ts`** —
  - `create` — mints `sf_<48 hex chars>`, stores only its SHA-256 hash + a 10-char display prefix, scoped to one environment, expiring in 1–365 days. **The plaintext is returned exactly once** and is unrecoverable afterwards.
  - `list` — metadata for all tokens in a project (prefix, scope, expiry, revoked/last-used).
  - `revoke` — marks `revokedAt` (revoking twice is a 400).
  - `validateForRequest(presented, projectId, envName, ip)` — the gate used by `CombinedAuthGuard`: hash lookup → reject unknown (401) → audited denials for revoked/expired → **IP allowlist enforcement** (`ipMatches` supports exact IPs and CIDR, IPv4 and IPv6, with `::ffff:` normalization) → **scope check**: the token only works for the exact `:projectId/:env` it was created for (wrong scope = audited 403). On success, best-effort `lastUsedAt` stamp and returns a `ServiceTokenActor`.
- **`src/tokens/combined-auth.guard.ts`** — Extends the JWT guard: if the `Authorization` header is `Bearer sf_…`, it validates the service token and attaches `request.serviceToken`; anything else falls through to normal JWT auth. This is what lets the same secrets endpoints serve humans and CI.
- **`src/tokens/tokens.controller.ts`** — Management routes (user-JWT only — service tokens can't manage tokens): `POST /projects/:id/envs/:env/tokens` (ADMIN), `GET /projects/:id/tokens` (READ), `DELETE /projects/:id/tokens/:tokenId` (ADMIN).
- **`src/tokens/dto.ts`** — `CreateTokenDto` (name ≤60 chars, `expiresInDays` 1–365).
- **`src/tokens/tokens.module.ts`** — Provides/exports `TokensService` + `CombinedAuthGuard`.

### 3.9 Audit module

- **`src/audit/audit.service.ts`** — Append-only audit writer. The critical rule: **never log secret values**. `sanitizeMeta` drops any meta key matching `/^(value|values|secret|plaintext|password|token|...)$/i`, truncates strings to 200 chars, and JSON-stringifies other objects. `record()` writes the row; failures are logged loudly but never break the request path. Defines the `AuditAction` union (all 25+ actions: auth events, org/project/member changes, secret CRUD/reveal/export, token lifecycle, access denials).
- **`src/audit/audit.controller.ts`** — `GET /audit` (JWT-guarded) with filters `project`, `action`, `since`, `until`, `limit` (≤200), `offset`. **Security-critical scoping**: the `where` clause is built so it can never degrade to "match everything" — entries are restricted to the user's orgs (plus the explicitly-verified project filter); the code comments call out the Prisma `undefined`-field trap that would otherwise cause a cross-org audit leak.
- **`src/audit/audit.module.ts`** — `forwardRef(() => AuthModule)` (breaks the cycle), exports `AuditService`.

### 3.10 API tests — `apps/api/test/`

- **`test/setup-e2e.ts`** — Loads the repo `.env` then `.env.e2e` overrides (test DB), sets `NODE_ENV=test`, and fails fast if `DATABASE_URL`/`SECRETFORGE_MASTER_KEY`/`JWT_SECRET` are missing.
- **`test/jest-e2e.json`** — Jest e2e config (`--runInBand` since suites share one database).
- **`test/auth.e2e-spec.ts`** — Signup/login/refresh/logout/me/change-password flows: token rotation, replay rejection, session revocation on password change, validation errors.
- **`test/oauth.e2e-spec.ts`** — OAuth state issuance/consumption, exchange-code single-use + expiry, the TOTP gate on social sign-in (pending code stays redeemable after a wrong TOTP).
- **`test/projects.e2e-spec.ts`** — Project CRUD, environments, membership rules (org membership required, last-admin protection, role enforcement).
- **`test/secrets.e2e-spec.ts`** — Secret upsert/reveal/export/delete, versioning, rollback, groups, import parsing, RBAC matrix, and proof that values never appear in audit meta.
- **`test/sharing-audit.e2e-spec.ts`** — Cross-cutting: sharing flows + audit scoping (no cross-org leaks), service-token scope/expiry/revocation/IP-allowlist denials.
- **`test/cli-auth.e2e-spec.ts`** — Browser CLI login: `cli/start` redirect + param validation, `authorize` requires auth, mint→exchange→single-use replay rejection, garbage/expired codes, and the **OAuth-only account** case (`passwordHash: null`) that motivated the feature.

---

## 4. `apps/web` — The Next.js Frontend

### 4.1 Config & infrastructure

- **`apps/web/package.json`** — Web manifest. Deps: `next` 14, `react` 18, `qrcode` (TOTP QR), `@tabler/icons-webfont`.
- **`apps/web/next.config.js`** — Two jobs:
  1. **API proxy**: `rewrites()` maps `/api/:path*` → `NEXT_PUBLIC_API_URL` (default `http://localhost:4000`). The browser only ever talks to the web origin, so cookies are first-party and CORS is a non-issue.
  2. **Security headers**: a strict Content-Security-Policy (`default-src 'self'`, `object-src 'none'`, `frame-ancestors 'none'`, allowances only for the Pingie support widget and dev tooling), `X-Content-Type-Options`, `X-Frame-Options: DENY`, `Referrer-Policy`, `Permissions-Policy`, and HSTS in production.
- **`apps/web/tsconfig.json`** — Next.js TS config with the `@/*` path alias.

- **`app/layout.tsx`** — Root layout: global CSS + Tabler icons, wraps everything in `<Providers>`, sets metadata, and lazy-loads the third-party support/chat widget (`next/script`, `lazyOnload`).
- **`app/providers.tsx`** — Client provider stack: `ToastProvider` → `ConfirmProvider` → `UserProvider`.
- **`app/page.tsx`** — `/` just routes: access token in localStorage → `/projects`, else `/login`.
- **`app/globals.css`** — The design system: CSS custom properties (`--bg`, `--panel`, `--border`, `--accent`, `--warn`, text shades), and the shared component classes every page uses (`.panel`, `.btn`, `.input`, `.field`, `.table`, `.badge`, `.modal-*`, `.toast`, `.spinner`, `.segmented`, `.kpi`, `.empty`, `.error-box`). Dark, square-cornered aesthetic.
- **`app/icon.svg`** — Favicon (the "S" mark).
- **`app/robots.ts`** — robots.txt: allow `/`, `/docs`, `/login`; disallow all authenticated areas, invite links, auth callback, and the API proxy.
- **`app/sitemap.ts`** — Sitemap with only the three public pages.

### 4.2 Client libraries — `apps/web/lib/`

- **`lib/api.ts`** — The browser API client, the heart of the frontend:
  - Access token kept in memory + `localStorage` (`sf_access_token`); the **refresh token lives only in the httpOnly cookie** (M5) — JS can never read it.
  - `api<T>(path, init)` — attaches the Bearer token; on 401 it calls `/auth/refresh` (cookie rides along automatically on same-origin `/api/*`) and retries once; throws `ApiError` with the server's message.
  - `auth` namespace: `login` / `signup` / `exchangeOAuthCode` (all three understand the `totp_required` challenge and surface it as `ApiError.totpRequired`), `providers()` (which social buttons to show), `logout()` (fires `/auth/logout`, clears local tokens).
  - All the shared TypeScript shapes (`Me`, `Org`, `Project`, `SecretRow`, `ServiceTokenInfo`, `AuditEntry`, …) plus `groupQuery()` / `refLabel()` helpers for secret groups.
- **`lib/useUser.tsx`** — `UserProvider` + `useUser()` hook: on mount calls `/auth/me` to establish the session (the refresh cookie mints a fresh access token if needed), exposes `{ user, loading, refresh, logout }`. `refresh()` sets `loading` during the check so guarded pages don't bounce to `/login` mid-refresh.
- **`lib/format.ts`** — `envLabel()` ("dev" → "Development").

### 4.3 Public / auth pages

- **`app/login/page.tsx`** — Combined sign-in/sign-up: email+password form, Google/GitHub buttons (rendered only when `/auth/providers` says they're configured, linking to `/api/auth/<provider>?next=…`), `?next=` redirect sanitization (same-origin only), and the **2FA step** — on a `totpRequired` error it reveals the 6-digit code field while keeping the typed password. After auth it `refresh()`es the user context *before* navigating (otherwise `/projects` would bounce back).
- **`app/auth/callback/page.tsx`** — Landing page for social sign-in: redeems the `?code=` exchange code via `auth.exchangeOAuthCode`. A `useRef` guard defeats React StrictMode's double-invoke (the code is single-use). On `totpRequired` it shows the authenticator-code form and re-posts code + TOTP (the exchange code stays valid for retries). On success it cleans the URL and routes to `?next=` (sanitized) or `/projects`.
- **`app/cli-auth/page.tsx`** — The approve page for browser `forge login`: validates `?port&state`, bounces to `/login?next=/cli-auth…` when signed out, and on **Approve** mints a code via `POST /api/auth/cli/authorize`, displays it (selectable, for headless machines), then redirects the browser to `http://127.0.0.1:<port>/callback?code&state` where the CLI is listening.
- **`app/invite/[token]/page.tsx`** — Public invite landing: fetches the preview (org name, role, masked email), and either lets the signed-in user accept (`POST /api/invites/accept`) or sends visitors to `/login?next=/invite/<token>` to come back after auth.
- **`app/docs/page.tsx`** — Public documentation (no auth): sticky anchor nav + content panels covering getting started, CLI, groups, service tokens, both SDKs, CI, roles, the security model, and an API reference.

### 4.4 App pages (authenticated)

- **`app/projects/page.tsx`** — Project list: loads orgs + projects, first-run empty state doubles as the "create your organization" form, project cards show environments and member counts, and a modal creates projects (auto-creating dev/staging/prod).
- **`app/projects/[projectId]/page.tsx`** — Overview dashboard: KPI cards (secrets, members, your role, active tokens), a secrets-by-environment bar breakdown, quick-start links, and a recent-activity feed (last 8 audit entries with denial highlighting and `timeAgo` timestamps).
- **`app/projects/[projectId]/secrets/page.tsx`** — The main vault UI (600 lines): environment switcher (segmented control), **Secrets vs Groups views** (ungrouped secrets vs group list → group detail), group creation (persisted to localStorage so empty groups survive reloads), per-row **Reveal** (decrypted server-side on demand, auto-hides after 30s), add-secret and `.env`-import modals, delete with confirm (ADMIN), "Copy all" export (one `.env` block per group, to the clipboard), and role-gated actions (`canWrite`/`canAdmin` from `project.yourRole`).
- **`app/projects/[projectId]/versions/page.tsx`** — Version history: secret picker (deep-linkable via `?key&group`), full version list, and ADMIN rollback (confirm dialog → POST rollback → toast with the new version number).
- **`app/projects/[projectId]/members/page.tsx`** — Project membership: member table with role badges, share dialog (email + role, backed by `/shareable-members`), role changes, and removal (confirm; self-removal allowed).
- **`app/projects/[projectId]/tokens/page.tsx`** — Service-token management: create form (name, env, expiry days), the **show-once plaintext token panel** with copy button, token table (prefix, scope, expiry, last-used), and revoke with confirm.
- **`app/projects/[projectId]/audit/page.tsx`** — Audit log: action filter dropdown (human labels for every `AuditAction`), paginated table (50/page) of actor/action/resource/IP/time.
- **`app/projects/[projectId]/integrate/page.tsx`** — Copy-paste integration snippets, project-specific: CLI install/login/init/run (including `--group`), the `.secretforge.json` link file, Node SDK (build-from-repo note), Python SDK, groups usage, and a GitHub Actions CI example with the `SECRETFORGE_URL` vs `SECRETFORGE_TOKEN` warning.
- **`app/projects/[projectId]/settings/page.tsx`** — Project settings (ADMIN): rename, add custom environments, and the danger zone — delete requires typing the project name.
- **`app/orgs/[orgId]/page.tsx`** — Org management: rename (OWNER/ADMIN), member table with role changes (OWNER rules enforced server-side), invite creation (shows the shareable `/invite/<token>` link once), pending invite list with revoke.
- **`app/account/page.tsx`** — Account settings: display name, change password (notes that other sessions get signed out), and the full **2FA flow** — setup (QR + manual secret + verification code), enabled state, and disable (requires a current code).

### 4.5 Components — `apps/web/components/`

- **`components/ui.tsx`** — Shared primitives: `PageHeader` (title/description/actions), `Loading`, `ErrorState` (with retry), `InlineError`, `BusyButton` (self-spinnerizing async button), `Modal` (overlay + head/body/foot).
- **`components/Toast.tsx`** — Toast notifications: `ToastProvider` + `useToast().show(msg, 'info'|'error')`, auto-dismiss after 4s.
- **`components/Confirm.tsx`** — Promise-based replacement for `window.confirm`: `await confirm({ title, message, danger })` resolves true/false; a newer dialog supersedes an unanswered one.
- **`components/Icon.tsx`** — Inline SVG icon set (square-cap stroke paths, ~30 icons) — no icon-font runtime cost for app chrome.
- **`components/TotpQr.tsx`** — Renders the `otpauth://` URL as a QR **entirely in the browser** with the `qrcode` library — the TOTP secret never leaves the page (no third-party QR service can see it).
- **`components/shell/AppShell.tsx`** — Two layouts: `OrgShell` (topbar only, wide column) and `ProjectShell` (topbar + sidebar).
- **`components/shell/Sidebar.tsx`** — Project nav grouped into Project (Overview/Secrets/Versions), Access (Members/Tokens), Integrate, Manage (Audit/Settings), with active-state highlighting and the project card (name, your role, org).
- **`components/shell/Topbar.tsx`** — Global header: brand, org breadcrumb/switcher, docs link, and the account menu (initials avatar, account page, logout) with outside-click/Escape dismissal.
- **`components/shell/shell.module.css`** — CSS module for the shell layout (topbar, sidebar, main columns, breadcrumbs, menus).

---

## 5. `packages/cli` — The `forge` CLI (npm: `@gtools-spaces/cli`)

- **`package.json`** — Publishes `dist/` only; binaries `forge` and `secretforge`; `prepublishOnly` builds with `tsc`; single runtime dep `commander`; Jest + ts-jest for tests. Current version **0.1.6**.
- **`tsconfig.json`** — CommonJS output to `dist/` (Node 20 target), declarations + source maps.
- **`.npmignore` / `LICENSE` / `README.md`** — Packaging: sources excluded from the tarball, MIT license, and user docs (install, login incl. browser flow, every command, CI usage, updating).

- **`src/index.ts`** — Entry point (`#!/usr/bin/env node`). Reads the version from `package.json` (so `--version` never drifts) and registers commands with commander: `login` (`--url`, `--password`, `--code`), `logout`, `whoami`, `init` (`--project`, `--env`, `--group`), `set`, `list`, `run` (variadic, `allowUnknownOption` so everything after `--` passes through), `pull` (`--stdout`), `import`. Errors → message + exit 1.

- **`src/commands.ts`** — Command implementations:
  - `cmdLogin(urlFlag, { password, code })` — guards against the classic mistake of putting an `sf_` token in `SECRETFORGE_URL`, then branches: `--code` → `exchangeCliCode` (headless), `--password` → `passwordLogin` (email + password prompt with the **TOTP retry**: on a 401 `totp_required` it prompts "Two-factor code:" and re-posts), default → `browserLogin`.
  - `passwordLogin` — the original flow: prompts, posts `/auth/login`, stores the returned tokens.
  - `cmdLogout` — best-effort server-side revocation, then always clears local credentials.
  - `cmdWhoami` — `GET /auth/me`.
  - `cmdInit` — interactive project picker (or `--project`), writes `.secretforge.json` (projectId + defaultEnv + optional group) — safe to commit.
  - `cmdSet` — `KEY=value` (or key-only → hidden prompt) → `PUT …/secrets/:key`.
  - `cmdList` — masked key listing (group-aware display `group/KEY`).
  - `cmdRun` — the flagship: fetches `/secrets/export`, merges over `process.env` (**secrets win**), spawns the child with inherited stdio, and propagates exit codes/signals. Nothing touches disk.
  - `cmdPull` — escape hatch: writes a chmod-600 `.env` with a loud plaintext warning (or `--stdout`).
  - `cmdImport` — pushes an existing `.env` file via `/secrets/import`, then reminds you to rotate anything previously shared.
  - `fail()` — maps `ApiError` statuses to friendly messages (401 → "Run `forge login`").

- **`src/browser-login.ts`** — The device-style browser flow (v0.1.6):
  1. `startCallbackServer(state)` — HTTP server on `127.0.0.1:0` (random port); `/callback` validates the anti-CSRF `state`, serves a "Signed in — close this tab" page, resolves the code; 3-minute timeout.
  2. `openBrowser(url)` — zero-dep platform spawn (`open` / `cmd /c start` / `xdg-open`), detached.
  3. `browserLogin(apiUrl)` — generates a 16-byte hex state, opens `<api>/auth/cli/start?port&state`, prints the URL + headless instructions (`forge login --code <code>`), waits for the redirect, then exchanges.
  4. `exchangeCliCode(apiUrl, code)` — `POST /auth/cli/exchange`, saves credentials, prints "Logged in as …".

- **`src/api-client.ts`** — Authenticated HTTP client:
  - `ApiClient` wraps stored credentials; `ensureFreshToken()` decodes the JWT `exp` (without verifying — that's the API's job) and proactively refreshes within 30s of expiry; `request()` retries once on 401 after a refresh; refreshed tokens are persisted back to disk.
  - `requireClient()` — resolution order: **`SECRETFORGE_TOKEN` (service token) wins** (wrapped as a non-refreshing credential), else stored user credentials, else exit with "Run `forge login`".
  - `ApiError` carries status + parsed body message.

- **`src/config.ts`** — File layout and resolution:
  - Credentials: `~/.secretforge/credentials.json` written **chmod 600** (dir 700).
  - Project link: `.secretforge.json` discovered by **walking up** from the CWD (like `package.json` resolution) so commands work from any subdirectory.
  - `defaultApiUrl()` — `SECRETFORGE_URL` or `http://localhost:4000`, with the `sf_`-mixup guard.
  - Resolution orders: env = `--env` > `SECRETFORGE_ENV` > link `defaultEnv` > `"dev"`; group = `--group` > `SECRETFORGE_GROUP` > link group > ungrouped; `groupQuery()` builds the `?group=` suffix.

- **`src/env-file.ts`** — `parseSetArg` (split on first `=`, key-only allowed), `mergeEnv` (secrets override the base env), `formatEnvFile` (round-trip-safe serialization mirroring the API).
- **`src/prompt.ts`** — Prompt utilities with a subtle trick: for **piped stdin** (scripts/CI) all of stdin is buffered up front and prompts consume lines in order (readline interfaces discard buffered data when closed, which breaks sequential prompts); for TTYs, `promptHidden` uses raw mode for no-echo password entry with Ctrl+C handling.
- **`src/cli.spec.ts`** — 18 unit tests: env-file parsing/serialization, set-arg parsing, config resolution order, project-file discovery, JWT exp decoding.

---

## 6. `packages/sdk-node` — Node SDK (`@gtools-spaces/sdk`, repo-only)

- **`src/index.ts`** — Zero-dependency library, **service-token auth only** (user JWTs intentionally unsupported — servers/CI should never carry a user session):
  - `load(opts?)` — resolves options (explicit arg > `SECRETFORGE_TOKEN`/`SECRETFORGE_ENV`/`SECRETFORGE_GROUP`/`SECRETFORGE_URL` env vars > `.secretforge.json` discovered upward from CWD), then fetches `/projects/:id/envs/:env/secrets/export` with the `sf_` Bearer token and returns the values object. Throws `ForgeError` (with HTTP status) on failure.
  - `config(opts?)` — `load()` + merges into `process.env`, but **existing environment variables always win** over the vault.
- **`package.json` / `tsconfig.json`** — Build setup; marked `"private": true` (not published to npm — the Integrate page shows build-from-repo instructions).

## 7. `packages/sdk-python` — Python SDK (PyPI: `secretforge`)

- **`src/secretforge/__init__.py`** — Stdlib-only (`urllib`) mirror of the Node SDK: same option resolution (`_resolve` → args > env vars > `.secretforge.json` walk-up), `load()` fetches the export endpoint with the service token (15s timeout, `ForgeError` with status on HTTP/URL errors), `config()` merges into `os.environ` via `setdefault` (real env wins). `__version__ = "0.1.0"`.
- **`pyproject.toml`** — Packaging metadata (Python ≥3.9, no dependencies).
- **`README.md` / `LICENSE`** — Usage docs and MIT license.

## 8. `examples/sample-app/` — Runnable demo

- **`.secretforge.json`** — A real link file pointing at a demo project (`forge init` output).
- **`run-with-cli.sh`** — End-to-end CLI demo: `whoami` → `list` (keys only) → `forge run -- node -e …` proving the secret reaches the child process with nothing on disk.
- **`node-app.mjs`** — Node SDK demo: `await config()` then reads `process.env.SAMPLE_API_KEY`; also shows the no-side-effect `load()`.
- **`python_app.py`** — The same demo for the Python SDK.
- **`README.md`** — How to run the samples.

## 9. `deploy/`

- **`deploy/Caddyfile`** — HTTPS reverse proxy for self-hosting: replace `vault.example.com` with your domain, run `docker compose --profile tls up -d`; Caddy auto-obtains/renews Let's Encrypt certs, gzips, and proxies to `api:4000`.

---

## 10. Key End-to-End Flows (how the files cooperate)

**Password login with 2FA:**
`login/page.tsx` → `POST /api/auth/login` (proxied to API) → `AuthService.login` verifies argon2id → `totpEnabled` → 401 `totp_required` → page shows the code field → re-post with `totpCode` → `TotpService.verifyLogin` (decrypts secret with master key, RFC 6238 check) → `issueTokens` → access token to localStorage, refresh token into the httpOnly `sf_refresh` cookie.

**Social sign-in with 2FA:**
`login/page.tsx` → `/api/auth/google` → `OAuthService.authorizeUrl` (DB state) → Google → `/api/auth/google/callback` → `consumeState` (atomic) → `handleCallback` (verified profile, find/create user, mint exchange code with `pendingTotpUserId`) → 302 `/auth/callback?code=…` → `auth.exchangeOAuthCode` → 401 `totp_required` (code stays valid) → TOTP form → re-post → tokens.

**Browser CLI login (OAuth-only accounts):**
`forge login` → `browser-login.ts` listens on 127.0.0.1, opens `/auth/cli/start` → API 302 → `/cli-auth` page (sign in with *any* method incl. Google/GitHub + 2FA) → Approve → `POST /auth/cli/authorize` mints `CliAuthCode` → browser redirects to the CLI's localhost callback → CLI `POST /auth/cli/exchange` → tokens saved chmod 600.

**Secret write:**
Web/CLI → `PUT …/secrets/:key` → `CombinedAuthGuard` (JWT) → `ProjectRoleGuard` (WRITE) → `SecretsService.upsert` → unwrap project DEK (master key) → AES-256-GCM encrypt → transaction: update `Secret` + append `SecretVersion` → audit `SECRET_CREATED/UPDATED` (sanitized).

**CI read:**
GitHub Action with `SECRETFORGE_TOKEN=sf_…` → SDK/CLI `GET …/secrets/export` → `CombinedAuthGuard` sees `Bearer sf_` → `TokensService.validateForRequest` (hash, expiry, revocation, IP allowlist, exact env scope) → `ProjectRoleGuard` (READ only) → decrypt all → audit `SECRET_READ` (actorType TOKEN) → values merged into the process environment.

---

*Generated as a comprehensive reference — every source file in the repository is covered above. When the code changes, update the relevant section.*
