# Deploying SecretForge

```
Browser ──► Vercel   (web UI, Next.js)        https://<app>.vercel.app
              │ /api/* rewrite
              ▼
            Render   (API, NestJS)            https://secretforge-api.onrender.com
              │
              ▼
            Neon     (Postgres, serverless)   ✅ already set up
```

- **Web → Vercel** — Next.js native hosting, free tier, preview deploys.
- **API → Render** — long-running Node server (NestJS + Prisma), free web service.
- **DB → Neon** — done; you have the pooled + direct connection strings.

> ⚠️ Render free tier sleeps after ~15 min idle — the first request after idle
> takes ~30–60 s (cold start). Upgrade to a paid plan ($7/mo) to remove this.

---

## 1. Database (Neon) — ✅ done

You already have:

- `DATABASE_URL` — pooled endpoint (host contains `-pooler`) → app runtime
- `DIRECT_URL` — direct endpoint (same host **without** `-pooler`) → migrations

Nothing to do here.

## 2. API → Render

1. Push this repo to GitHub (done — `render.yaml` is at the root).
2. [Render dashboard](https://dashboard.render.com) → **New → Blueprint** →
   select `G-Tools-Spaces/SecretForge`. Render detects `render.yaml` and
   creates the `secretforge-api` web service.
3. When prompted (or later under **Environment**), fill in:

   | Key | Value |
   |---|---|
   | `DATABASE_URL` | Neon **pooled** URL (`…-pooler…?sslmode=require`) |
   | `DIRECT_URL` | Neon **direct** URL (same, without `-pooler`) |
   | `SECRETFORGE_MASTER_KEY` | `openssl rand -base64 32` — **back this up; losing it loses ALL secrets** |
   | `JWT_SECRET` | `openssl rand -base64 48` |
   | `WEB_ORIGIN` | `https://<app>.vercel.app` (step 3 gives you this) |
   | `API_PUBLIC_URL` | `https://secretforge-api.onrender.com` |
   | `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | optional — social sign-in |
   | `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET` | optional — social sign-in |

4. Deploy. The start command runs `prisma migrate deploy` (idempotent) and
   then boots the API. Health check: `https://secretforge-api.onrender.com/auth/providers`
   should return `{"google":true,"github":true}`.

> Use a **production** master key, not your dev one — and store it somewhere
> safe (password manager). Rotating it means re-encrypting every secret.

## 3. Web → Vercel

1. [vercel.com](https://vercel.com) → **Add New → Project** → import
   `G-Tools-Spaces/SecretForge`.
2. Set **Root Directory** to `apps/web` (Vercel detects Next.js automatically;
   keep the default build command).
3. Add environment variables:

   | Key | Value |
   |---|---|
   | `NEXT_PUBLIC_API_URL` | `https://secretforge-api.onrender.com` |
   | `NEXT_PUBLIC_SITE_URL` | `https://<app>.vercel.app` (for sitemap/robots) |

   The app proxies browser calls `/api/*` → `NEXT_PUBLIC_API_URL` via a
   Next.js rewrite, so no CORS changes are needed for same-origin use.
4. Deploy → you get `https://<app>.vercel.app`.
5. Back in Render, set `WEB_ORIGIN=https://<app>.vercel.app` and redeploy
   (needed for the OAuth callback redirect and any direct browser→API calls).

## 4. OAuth consoles (if using Google/GitHub sign-in)

Add the production redirect URIs:

- **Google Cloud Console** → Credentials → your OAuth client →
  Authorized redirect URIs: `https://secretforge-api.onrender.com/auth/google/callback`
  (keep the localhost one for dev).
- **GitHub** → Developer settings → OAuth Apps → your app →
  Authorization callback URL: `https://secretforge-api.onrender.com/auth/github/callback`.

## 5. Pingie support widget

The widget only loads on allowlisted domains. In the Pingie dashboard for
`bot_stkhkbf`, add `https://<app>.vercel.app` to the bot's **allowed domains**
(otherwise the chat bubble won't appear in prod). The CSP in
`apps/web/next.config.js` already allowlists the Pingie origins.

## 6. Smoke test

1. `https://<app>.vercel.app/login` — sign up a new account (lands in Neon).
2. Google + GitHub buttons appear and complete the flow.
3. Create a project → add a secret → reveal it (proves master key + encryption).
4. CLI: `SECRETFORGE_URL=https://secretforge-api.onrender.com forge login`.
5. Chat widget loads bottom-right.

## Notes

- **Migrations**: run automatically on every API boot (`npm run db:deploy`).
  To add a new migration: `npm run db:migrate` locally, commit, push — Render
  redeploys and applies it.
- **Local dev is unaffected**: root `.env` points at Neon, e2e tests still use
  the throwaway local `secretforge_test` DB (docker-compose Postgres).
- **Custom domain** later: add it in Vercel (web) and Render (API), then update
  `WEB_ORIGIN`, `API_PUBLIC_URL`, `NEXT_PUBLIC_API_URL`, OAuth redirect URIs,
  and the Pingie allowed domains.
- Alternative single-platform option: Render can also host the web app as a
  Node service (`npm run build -w apps/web && npm run start -w apps/web`), but
  Vercel is the better Next.js home (edge caching, previews, zero config).
