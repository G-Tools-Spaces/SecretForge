# SecretForge — User Guidelines

The complete guide to using SecretForge: your team's secrets vault.
This covers every feature in the web app, the `forge` CLI, and the Node.js / Python SDKs.

---

## Table of contents

1. [What is SecretForge?](#1-what-is-secretforge)
2. [Key concepts](#2-key-concepts)
3. [Getting started](#3-getting-started)
4. [Organizations](#4-organizations)
5. [Projects & environments](#5-projects--environments)
6. [Managing secrets](#6-managing-secrets)
7. [Members & roles](#7-members--roles)
8. [Service tokens (for CI & SDKs)](#8-service-tokens-for-ci--sdks)
9. [The forge CLI](#9-the-forge-cli)
10. [Node.js SDK](#10-nodejs-sdk)
11. [Python SDK](#11-python-sdk)
12. [CI/CD integration](#12-cicd-integration)
13. [Audit log](#13-audit-log)
14. [Account settings](#14-account-settings)
15. [How your secrets are protected](#15-how-your-secrets-are-protected)
16. [FAQ & troubleshooting](#16-faq--troubleshooting)

---

## 1. What is SecretForge?

SecretForge is a self-hosted secrets manager. Instead of scattering API keys,
database passwords and tokens across `.env` files, Slack messages and Notion
pages, your team stores them in one encrypted vault — with access control,
version history, and a full audit trail.

- **Web app** — manage everything from the browser.
- **`forge` CLI** — pull secrets into your terminal and dev workflow.
- **Node.js & Python SDKs** — load secrets straight into your app at boot.
- **Service tokens** — read-only credentials for CI/CD pipelines.

## 2. Key concepts

```
Organization  (your team/company)
  └── Project  (one app or service, e.g. "billing-api")
        └── Environment  (Development / Staging / Production, or custom)
              └── Secret  (a key-value pair, e.g. STRIPE_SECRET_KEY=sk_live_…)
                    optionally filed under a Group  (e.g. "frontend", "backend")
```

- **Organization** — the top-level workspace. All members and projects live here.
- **Project** — a service or app whose secrets you manage together.
- **Environment** — a named stage inside a project. Every project starts with
  Development, Staging and Production; you can add custom ones.
- **Secret** — a key + encrypted value inside one environment. Every change
  creates a new **version** (history is never lost).
- **Secret group** — an optional label on a secret (e.g. `frontend`,
  `backend`) that splits one environment into per-service namespaces. The
  same key can exist once per group plus once ungrouped.
- **Service token** — a read-only, single-environment credential for machines
  (CI jobs, deployed apps) — not for people.

## 3. Getting started

### 3.1 Create your account

Open the web app (e.g. `http://localhost:3000`) and choose one of:

- **Continue with Google** / **Continue with GitHub** — one-click sign-in
  (shown only when the admin has configured the provider).
- **Email + password** — password must be at least 10 characters.

> Signing in with Google/GitHub using the same email as an existing password
> account automatically links both sign-in methods to one account.

### 3.2 Create your organization

On first login you'll be asked to create an organization (e.g. your company or
team name). You become its **OWNER**.

### 3.3 Create your first project

From the Projects page → **New project**. Give it a name — SecretForge creates
three environments (Development, Staging, Production) automatically. You are
the project's first **ADMIN**.

### 3.4 Add your first secret

Open the project → **Secrets** → pick an environment tab → **Add secret** →
enter the key (e.g. `DATABASE_URL`) and value → Save. The value is encrypted
immediately and is never shown in lists — only when you explicitly reveal it.

## 4. Organizations

Open your organization from the top bar (`SecretForge / <Your org>`) to manage it.

### 4.1 Inviting teammates (invite links)

1. On the org page, click **Invite member**.
2. Enter their email and choose an org role (MEMBER or ADMIN).
3. SecretForge creates a **one-time invite link** — copy it and send it to them
   (Slack, email, anywhere). No email is sent automatically in this
   self-hosted setup.
4. They open the link, see who invited them and to which org, sign in (or
   create an account) **with that exact email address**, and click
   **Accept invite**.

Facts about invite links:

- Valid for **7 days**, **single-use**, and work **only for the invited email**.
- Admins can see pending invites on the org page, re-copy the link, or
  **revoke** it at any time.
- Inviting the same email again replaces any expired/used invite.

### 4.2 Managing members

On the org page, admins can:

- **Change roles** with the dropdown next to a member.
- **Remove a member** — they instantly lose access to all org projects.

Safety rails: only an **OWNER** can grant the OWNER role or remove another
owner, and the **last owner** of an org can never be demoted or removed.

### 4.3 Renaming the org

Org page → **General** → edit the name → **Save** (OWNER/ADMIN only).

## 5. Projects & environments

### 5.1 Project overview page

The project **Overview** shows at a glance: secret counts, members, your role,
active service tokens, secrets-per-environment, a quick-start snippet, and
recent activity.

### 5.2 Adding a custom environment

Project → **Settings** → **Add environment** (e.g. `qa`, `preview`).
Custom environments behave exactly like the default three.

### 5.3 Renaming / deleting a project

Project → **Settings**:

- **Rename** — project ADMIN only.
- **Delete** — danger zone; you must type the project name to confirm.
  Deleting removes all its environments, secrets, versions and service tokens.
  (Audit entries survive, so the history of *what happened* is never erased.)

## 6. Managing secrets

Project → **Secrets**, then pick an environment tab. The page is split into
two tabs: **Secrets** (ungrouped keys) and **Groups** (per-service groups).

### 6.1 Adding / updating

**Add secret** (or click an existing key) → enter the value → Save.
Every save creates a **new immutable version** — old values are kept in the
version history, never overwritten.

### 6.2 Organizing with groups

Groups split one environment into per-service namespaces — e.g. a monorepo
can keep `frontend` and `backend` keys separate inside the same `prod`
environment.

- **Groups tab → Create group**, then add secrets into it (the **Add secret**
  and **Import** dialogs both have an optional *Group* field).
- Group names: lowercase letters, digits and dashes, max 30 chars
  (`frontend`, `billing-api`).
- The same key can exist ungrouped **and** once per group — they are
  independent secrets with independent version histories.
- The CLI and SDKs fetch one group at a time (or the ungrouped set) — see
  `--group` in §9 and the `group` option in §10/§11.

### 6.3 Revealing a value

Lists always show secrets **masked**. Click the reveal action to view a value.
Reveals are **individually audit-logged and rate-limited** (60/min).

### 6.4 Bulk import (.env paste)

**Import** → paste `.env`-style content (`KEY=value` lines) → all keys are
upserted in one go. Requires the WRITE role or above.

### 6.5 Export

**Export** downloads all values in the environment as `.env` text. Exports are
audit-logged and rate-limited (10/min) — treat the exported file like a
password.

### 6.6 Version history & rollback

Project → **Versions** → pick environment + secret → see every version, who
changed it and when. Admins can **roll back** to any older version — rollback
creates a *new* version copying the old value forward (history stays
append-only).

### 6.7 Deleting a secret

Requires project ADMIN. The secret and its version history are removed.

## 7. Members & roles

SecretForge has **two separate role systems**. Org roles manage the team;
project roles control secrets. Being an org admin does **not** automatically
grant access to a project's secrets — project access is assigned per project.

### 7.1 Org roles

| Capability | OWNER | ADMIN | MEMBER |
|---|:---:|:---:|:---:|
| View org, members, project list | ✓ | ✓ | ✓ |
| Be added to projects | ✓ | ✓ | ✓ |
| Rename org | ✓ | ✓ | — |
| Invite members / manage invites | ✓ | ✓ | — |
| Change member roles | ✓ | ✓ | — |
| Grant/revoke OWNER | ✓ | — | — |
| Remove members | ✓ | ✓ | — |
| Remove or demote an OWNER | ✓ | — | — |

### 7.2 Project roles

| Capability | ADMIN | WRITE | READ |
|---|:---:|:---:|:---:|
| List secrets (masked), reveal, export, view versions | ✓ | ✓ | ✓ |
| Add/update secrets, bulk import | ✓ | ✓ | — |
| Delete secrets, rollback versions | ✓ | — | — |
| Manage project members | ✓ | — | — |
| Project settings, add environments, delete project | ✓ | — | — |
| Create/revoke service tokens | ✓ | — | — |

### 7.3 Adding someone to a project

Project → **Members** → **Add member** → pick an org member → assign READ,
WRITE or ADMIN. (Only org members can be added — invite them to the org first.)

**Recommended setup:** keep most teammates as org MEMBER, then grant project-level
READ or WRITE only on the projects they actually work on. Reserve Production
access for the few who need it.

## 8. Service tokens (for CI & SDKs)

Service tokens are credentials for **machines**, not people: read-only, scoped
to a **single environment**, with an expiry date.

### 8.1 Create one

Project → **Tokens** → **New token** → name (e.g. `github-actions-prod`),
environment, lifetime in days → **Create**.

> The token value (`sf_…`) is shown **exactly once**. Copy it immediately —
> SecretForge stores only its hash and can never show it again.

### 8.2 What a token can do

- List, reveal and export secrets in its one environment. Nothing else — no
  writes, no other environments, no member or settings access.
- Attempts to use a token for anything else are denied and audit-logged.

### 8.3 Lifecycle

- Tokens expire automatically at the end of their lifetime.
- Admins can **revoke** a token at any time (Project → Tokens → Revoke) —
  revocation is instant.
- The tokens table shows status (active / expired / revoked), the token prefix
  (e.g. `sf_a1b2…`) for identification, and when it was last used.

## 9. The forge CLI

The `forge` CLI brings the vault into your terminal.

### 9.1 Install & setup (Windows / macOS / Linux)

**Yes — one download is required: Node.js 20 or newer.** The CLI itself is a
small npm package (`forge` command); it has no other system dependencies.

#### Step 1 — Install Node.js 20+

**Windows**
- Easiest: download the **LTS installer** from <https://nodejs.org> and run it
  (includes npm), **or**
- `winget install OpenJS.NodeJS.LTS` in PowerShell, **or**
- [nvm-windows](https://github.com/coreybutler/nvm-windows): `nvm install 20 && nvm use 20`
- Verify in a **new** terminal: `node -v` → should print `v20.x` or higher.

**macOS**
- `brew install node` (Homebrew), **or**
- the LTS installer from <https://nodejs.org>, **or**
- `nvm install 20 && nvm use 20` ([nvm](https://github.com/nvm-sh/nvm))
- Verify: `node -v`

**Linux**
- Ubuntu/Debian: `sudo apt install nodejs npm` (or NodeSource for the latest 20.x:
  `curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash - && sudo apt install -y nodejs`)
- Fedora/RHEL: `sudo dnf install nodejs`
- Any distro via nvm: `nvm install 20 && nvm use 20`
- Verify: `node -v`

#### Step 2 — Install the forge CLI

From npm (recommended) — current release is **0.1.6**:

```bash
npm install -g @gtools-spaces/cli        # or pin: @gtools-spaces/cli@0.1.6
```

Two identical commands are installed: **`forge`** and **`secretforge`** —
use whichever you like.

Or install from the repo (contributors / pre-release):

```bash
git clone <your-secretforge-repo-url> && cd SecretForge
npm install
npm run build -w packages/cli
npm link -w packages/cli        # puts `forge` on your PATH globally
```

#### Step 3 — Verify the install

```bash
forge --help        # prints the command list
```

#### Step 4 — Point it at your server & log in

The CLI talks to `http://localhost:4000` by default. If your SecretForge API
runs elsewhere, set `SECRETFORGE_URL` first:

```bash
# macOS / Linux (bash/zsh — add to ~/.zshrc or ~/.bashrc to persist)
export SECRETFORGE_URL="https://api.your-domain.com"

# Windows PowerShell (persists for your user)
[Environment]::SetEnvironmentVariable('SECRETFORGE_URL', 'https://api.your-domain.com', 'User')
```

> ⚠️ Don't mix up the two env vars:
>
> - `SECRETFORGE_URL` — the **API URL** (`https://…`)
> - `SECRETFORGE_TOKEN` — a **service token** (`sf_…`)
>
> The CLI refuses an `sf_…` value in `SECRETFORGE_URL` with a clear error
> (since 0.1.1) — tokens never go there.

```bash
forge login                         # opens your browser to sign in
forge whoami                        # verify you're authenticated
```

> Since CLI **0.1.6**, `forge login` opens your **browser**: sign in on the
> web app with **any** method — email + password, Google or GitHub, with
> 2FA — approve the CLI, and the terminal is logged in automatically. This
> is the only login that works for **OAuth-only accounts** (they have no
> password, so the old email+password prompt could never work for them).
>
> Fallbacks:
>
> - `forge login --password` — classic email + password prompt in the
>   terminal (asks for the 2FA code when enabled).
> - `forge login --code <code>` — headless/remote machines: approve in any
>   browser, then paste the code the page shows.

Credentials are stored in `~/.secretforge/credentials.json`
(`C:\Users\<you>\.secretforge\credentials.json` on Windows) with
owner-only permissions (chmod 600). `forge logout` deletes them.

### 9.2 Link a project

```bash
cd your-app
forge init                          # picks org → project → environment
```

This writes a `.secretforge.json` file (project + environment — **no secrets**)
into your repo. Commit it so teammates and CI get the same linkage.

### 9.3 Everyday commands

```bash
forge set DATABASE_URL "postgres://…"   # create/update a secret
forge import .env                       # bulk-import a .env file
forge list                              # masked list of keys
forge pull                              # write secrets to .env
forge run -- npm run dev                # run any command with secrets injected
forge logout                            # end the session
```

- `forge run` is the recommended dev workflow: secrets are injected into the
  process environment in memory — nothing touches disk.
- `forge pull` writes a real `.env` — make sure `.env` is in your `.gitignore`
  (`forge pull --stdout` prints instead of writing a file — handy for pipes).

**Working with groups:** every secret command accepts `-g, --group`:

```bash
forge init -g frontend                # pin this directory to the "frontend" group
forge set API_URL=https://… -g backend
forge list -g backend                 # without -g, `list` shows every group
forge run -g frontend -- npm run dev
```

The group is stored in `.secretforge.json` by `forge init -g`, so you only
need the flag once per directory.

### 9.4 Using a service token instead of login

```bash
export SECRETFORGE_TOKEN=sf_…
forge list          # no login needed; read-only, single environment
```

## 10. Node.js SDK

Package: `@gtools-spaces/sdk` — ⚠️ **not yet published to npm** (the source
lives in `packages/sdk-node` in the repo; install it from a checkout until
the first npm release).

### Step-by-step setup

1. **Create a service token** — web app → Project → Tokens → New token
   (pick the environment your app needs). Copy the `sf_…` value.
2. **Link your app** — run `forge init` in your app repo (creates
   `.secretforge.json`), or set env vars instead (step 4).
3. **Install the SDK** (from a repo checkout until it lands on npm):

   ```bash
   npm run build -w packages/sdk-node            # in your SecretForge clone
   npm install /path/to/SecretForge/packages/sdk-node
   ```

4. **Provide the token** — either env vars:

   ```bash
   export SECRETFORGE_TOKEN=sf_…
   # optional overrides:
   # export SECRETFORGE_URL=http://localhost:4000
   # export SECRETFORGE_ENV=prod
   ```

   …or pass them in code (below).

5. **Load secrets at boot, before anything else reads them**:

   ```ts
   import { load } from '@gtools-spaces/sdk';

   await load(); // process.env now contains your secrets

   // …the rest of your app
   console.log(process.env.DATABASE_URL);
   ```

   With explicit options:

   ```ts
   await load({ token: process.env.SECRETFORGE_TOKEN!, env: 'prod', group: 'backend' });
   ```

   `group` is optional — defaults to `SECRETFORGE_GROUP` → the group in
   `.secretforge.json` → ungrouped secrets only.

6. **Run your app** — secrets come from the vault, not from `.env` files.

The SDK throws a `ForgeError` (with HTTP status) on auth failures, wrong
environment, or network problems — fail fast at boot rather than running
without secrets.

## 11. Python SDK

Package: `secretforge` on PyPI — current release **0.1.0** (stdlib-only,
no dependencies, Python 3.9+).

### Step-by-step setup

1. **Create a service token** — Project → Tokens → New token. Copy the `sf_…` value.
2. **Link your app** — `forge init` in your repo (creates `.secretforge.json`),
   or use env vars.
3. **Install the SDK**:

   ```bash
   pip install secretforge        # or pin: secretforge==0.1.0
   ```

4. **Provide the token**:

   ```bash
   export SECRETFORGE_TOKEN=sf_…
   # optional: SECRETFORGE_URL, SECRETFORGE_ENV
   ```

5. **Load secrets at the top of your entrypoint**:

   ```python
   import secretforge, os

   secretforge.config()  # os.environ now contains your secrets

   db_url = os.environ["DATABASE_URL"]
   ```

   `config()` merges into `os.environ` (real environment variables win).
   Use `load()` if you just want a plain dict without touching `os.environ`:

   ```python
   secrets = secretforge.load(token=os.environ["SECRETFORGE_TOKEN"], env="prod", group="backend")
   ```

   `group` is optional — defaults to `SECRETFORGE_GROUP` → the group in
   `.secretforge.json` → ungrouped secrets only.

6. **Run your app** as usual.

Errors raise `secretforge.ForgeError` (carries the HTTP status).

## 12. CI/CD integration

Typical pipeline setup (works the same in GitHub Actions, GitLab CI, Jenkins…):

1. In the web app, create a **service token** scoped to the environment the
   pipeline deploys (e.g. Production), with a sensible lifetime.
2. Store it as a **CI secret** in your pipeline provider
   (e.g. GitHub: repo → Settings → Secrets and variables → Actions →
   `SECRETFORGE_TOKEN`).
3. In the pipeline, either:

   ```bash
   # Option A — CLI: inject secrets into a step
   export SECRETFORGE_TOKEN=${{ secrets.SECRETFORGE_TOKEN }}
   forge run -- npm test
   ```

   ```bash
   # Option B — SDK: the app loads secrets itself at boot
   export SECRETFORGE_TOKEN=${{ secrets.SECRETFORGE_TOKEN }}
   npm start
   ```

4. **Rotate** by creating a new token and updating the CI secret; revoke the
   old one. Because tokens expire, set a calendar reminder a few days before
   the expiry date.

## 13. Audit log

Project → **Audit log** shows every sensitive event: secret reveals, exports,
writes, deletes, rollbacks, member changes, token creation/revocation, logins
and denied access attempts (with reason + IP).

- Secret **values never appear** in the audit log — only key names and actions.
- Use it to answer "who saw what, when, from where".

## 14. Account settings

Click your avatar (top right) → **Account settings**:

- **Profile** — change your display name.
- **Two-factor authentication (2FA)** — set up a TOTP authenticator app
  (Google Authenticator, 1Password, …): scan the QR code, then enter the
  6-digit code to confirm. From then on, **every** sign-in — email + password,
  Google, or GitHub — requires the current code. Disabling 2FA requires a
  current code too.
- **Change password** — requires your current password; all *other* sessions
  are revoked automatically (a stolen session can't survive a password change).
  Not available for accounts that only use Google/GitHub sign-in.
- **Log out** — ends the current session (refresh token is revoked server-side).

## 15. How your secrets are protected

Plain-English version of the security model:

- **Envelope encryption** — every project has its own encryption key, which is
  itself encrypted ("wrapped") by a master key that exists only in the server's
  environment — never in the database, never in the repo. Secret values are
  encrypted with AES-256-GCM, with a unique IV per write.
- **Passwords** — hashed with argon2id (memory-hard, current OWASP
  recommendation). Never stored in readable form.
- **Two-factor authentication** — TOTP secrets are AES-256-GCM-encrypted with
  the master key at rest, and 2FA only activates after the user proves they
  scanned the code. No session tokens are issued until the second factor
  passes — on any sign-in method (password, Google, GitHub).
- **Sessions** — short-lived (15 min) access tokens + single-use refresh
  tokens stored only as hashes. If a refresh token is ever replayed, the whole
  session is revoked — token theft is detectable.
- **Service tokens** — stored as SHA-256 hashes, shown once, read-only,
  single-environment, expiring, revocable.
- **Social sign-in** — only provider-*verified* emails are accepted; tokens are
  never placed in URLs (a single-use 60-second exchange code is used instead).
- **Rate limiting** — global 300 req/min, with stricter limits on login,
  reveal, export and token endpoints.
- **Audit everything** — every mutation and every reveal is logged; secret
  values are cryptographically guaranteed to stay out of logs.

## 16. FAQ & troubleshooting

**I lost my service token value. Can you show it again?**
No — only its hash is stored. Create a new token and revoke the old one.

**The invite link says "invalid or expired".**
Links last 7 days and are single-use. Ask an org admin to revoke the old invite
and send a fresh one. Also make sure you're signing in with the exact email the
invite was issued for.

**Can I use both password and Google/GitHub sign-in?**
Yes — sign in with the same email and the identities link automatically.

**I clicked "Continue with Google" and got an error about test users.**
The Google OAuth app is in Testing mode — ask the admin to add your Gmail under
*OAuth consent screen → Test users* in Google Cloud Console.

**`forge run` vs `forge pull`?**
`run` injects secrets into a process in memory (preferred). `pull` writes a
`.env` file on disk — convenient, but treat the file as sensitive and never
commit it.

**Do I have to use groups?**
No — groups are optional. Secrets without a group live in the default
(ungrouped) namespace, and the CLI/SDKs behave exactly as before unless you
pass `--group` / `group=`. Groups only exist to keep per-service keys apart
inside one environment.

**Who can see Production secrets?**
Anyone with a project role (READ and above) *on that project* can reveal values
— every reveal is audit-logged. Use project membership to keep Production
tight, and use service tokens for machines.

**What happens when someone leaves the team?**
Remove them from the org — they instantly lose access to all its projects.
Their past actions remain in the audit log.

---

*For developer/API documentation, see `README.md` and the in-app **Docs** page.*
