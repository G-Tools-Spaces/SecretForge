# @gtools-spaces/cli

`forge` — the SecretForge CLI. Fetch secrets from your team's SecretForge
vault and inject them into your app's environment. No more `.env` files.

## Install

```bash
npm install -g @gtools-spaces/cli
```

Requires Node.js 20+. Two commands are installed: `forge` and `secretforge`
(they're the same binary — use whichever you like).

## Quick start

```bash
# 1. Point the CLI at your SecretForge API (skip for localhost:4000)
export SECRETFORGE_URL="https://your-api.example.com"
# Windows PowerShell:
# [Environment]::SetEnvironmentVariable('SECRETFORGE_URL', 'https://your-api.example.com', 'User')
#
# ⚠️ SECRETFORGE_URL = the API URL (https://...).
#    Service tokens (sf_...) go in SECRETFORGE_TOKEN — never in SECRETFORGE_URL.
#
# ⚠️ Only point SECRETFORGE_URL at a SecretForge API you control and trust —
#    your Bearer token is sent to whatever host this URL names.

# 2. Log in (once per machine; tokens stored in ~/.secretforge)
forge login
#    If your account has two-factor authentication enabled, the CLI
#    prompts for the 6-digit authenticator code after your password.

# 3. Link your repo to a project (writes .secretforge.json — safe to commit)
cd your-app
forge init

# 4. Run your app with secrets injected
forge run -- npm run dev
```

## Commands

| Command | What it does |
|---|---|
| `forge login` | Authenticate with your SecretForge server |
| `forge logout` | Revoke the session and remove stored tokens |
| `forge whoami` | Show the logged-in user |
| `forge init` | Link the current directory to a project + default env |
| `forge set KEY=value` | Create or update a secret (prompts if value omitted) |
| `forge list` | List secret keys (values are never shown) |
| `forge run -- <cmd>` | Start `<cmd>` with all secrets injected as env vars |

> **Security note (`forge run`):** injected secrets are visible in the child
> process's environment (`/proc/<pid>/environ` on Linux, to same-user tools
> like `ps -e` on some systems, and to any child that dumps its env). This is
> the standard trade-off (same as `docker run -e`) — prefer `forge pull
> --stdout` piping into a secrets manager if your threat model includes
> same-host same-user observers.
| `forge pull` | Write secrets to `.env` (escape hatch — prefer `forge run`) |
| `forge import [file]` | Push an existing `.env` file into the vault |

## How it works

Secrets are fetched from your self-hosted SecretForge API at process start
and injected into the child process environment — nothing is written to
disk. All secrets are encrypted at rest on the server (AES-256-GCM envelope
encryption); the CLI only ever sees plaintext in memory.

## CI usage

```yaml
- env:
    SECRETFORGE_URL: https://your-api.example.com
    SECRETFORGE_TOKEN: ${{ secrets.SECRETFORGE_TOKEN }}
  run: npx @gtools-spaces/cli run --env prod -- npm test
```

## Links

- [SecretForge](https://github.com/G-Tools-Spaces/SecretForge) — the server + web UI
- [Full setup guide](https://github.com/G-Tools-Spaces/SecretForge/blob/main/GUIDELINES.md)
