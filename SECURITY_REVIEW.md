# SecretForge — Comprehensive Security Review (Oct 2026)

Scope: **backend (apps/api), frontend (apps/web), CLI (packages/cli), Node SDK (packages/sdk-node), Python SDK (packages/sdk-python)**, plus deployment config. This is a secrets vault — the bar is "assume an attacker reads the DB, the network, and the repo."

---

## Executive summary

The overall security posture is **strong for a self-hosted v0.1 product**. Encryption at rest, token hashing, rotation, audit logging, rate limiting, and per-route RBAC are all implemented and mostly correct. **One critical broken-access-control bug was found and fixed** (audit log IDOR). A handful of medium/low findings remain, listed with recommendations.

| Severity | Count | Status |
|---|---|---|
| Critical | 1 | **FIXED** (audit OR bypass) |
| High | 0 | — |
| Medium | 4 | Documented, recommendations below |
| Low | 5 | Documented |

---

## CRITICAL — fixed in this review

### C1. Audit log IDOR: any user could read every org's audit entries
**File:** `apps/api/src/audit/audit.controller.ts`

The query filter ended with:

```ts
OR: [{ orgId: { in: orgIds } }, { projectId: projectFilter.projectId }],
```

When no `?project=` filter was supplied, `projectFilter.projectId` was `undefined`. **Prisma silently drops `undefined` fields**, so the second OR branch degraded to `{}` — which matches **every row in the table**. The `OR` therefore always passed and any authenticated user could page through the **entire global audit log**: other orgs' secret key names, user emails, source IPs, token names, and denied-access events.

**Impact:** cross-tenant information disclosure (STRIDE: Information Disclosure). For a secrets vault, audit metadata about *which keys exist in which envs* is itself sensitive.

**Fix applied:** the OR branch is now only included when a project filter actually exists:

```ts
OR: [
  { orgId: { in: orgIds } },
  ...(projectFilter.projectId ? [{ projectId: projectFilter.projectId }] : []),
],
```

Note: even the *intended* behavior was too broad — `OR: [orgId in myOrgs, projectId]` means a user who is a **project member but not an org member** sees that project's audit rows (that part is by design, since project members need audit visibility). The fix keeps that intent but removes the global leak.

---

## Backend (apps/api) — findings

### What's done right ✅
- **Crypto:** AES-256-GCM envelope encryption; per-project DEK wrapped by a 32-byte master key from env only; unique 96-bit IV per write; auth-tag verified on decrypt; decryption failure returns a generic 403 (no oracle on key mismatch vs tamper).
- **Passwords:** argon2id (OWASP-recommended), timing-consistent login (dummy hash verify when user missing), no user enumeration via response.
- **Sessions:** refresh tokens stored **only** as SHA-256 hashes, rotated on every use, replay revokes the session, password change revokes all other sessions.
- **Service tokens:** SHA-256 at rest, shown once, single-env scope, expiry + revocation, read-only enforced in `ProjectRoleGuard`, denials audited.
- **OAuth:** authorization-code flow, single-use `state` (10 min TTL), single-use 60s exchange codes stored hashed (real tokens never in URLs/logs), only provider-**verified** emails trusted, `next` restricted to same-origin paths (`//` blocked).
- **HTTP layer:** helmet, CORS origin whitelist, global ValidationPipe (whitelist + forbidNonWhitelisted + transform), global throttle 300/min plus tighter per-route limits on login/signup/refresh/exchange/reveal/export.
- **RBAC:** `ProjectRoleGuard` checks membership + role on every request; org guards re-check in services; last-owner/last-admin protections.
- **Audit:** append-only, sanitized meta (forbidden keys dropped, strings truncated), failures logged loudly but never break the request.
- **Config:** zod-validated env; refuses to boot with weak/missing JWT_SECRET or master key.

### Medium findings

**M1. `Project.wrappedDataKey` is returned by `GET /projects` list.**
`listForUser()` and `get()` strip it, but `create()`/`update()` return the Prisma object after destructuring — verify no path leaks it. (Reviewed: `create` and `update` both strip it. ✅ No action needed — but keep this invariant in mind for future endpoints; a regression test would help.)

**M2. OAuth `state` store is in-memory (`Map`).**
Fine for single-instance Render deployment, but: (a) lost on restart/redeploy (users mid-login get bounced — availability only), (b) **breaks if you ever scale to >1 API instance** (state set on instance A, callback hits instance B → login CSRF protection fails closed, but logins break). Recommendation: move to DB table with TTL before scaling horizontally.

**M3. `ServiceToken.ipAllowlist` and `Project.ipAllowlist` exist in the schema but are never enforced.**
The UI/schema promise "Allowed IPs" but `validateForRequest` never checks `request.ip` against them. Either enforce (compare `req.ip`/`X-Forwarded-For` with `app.set('trust proxy', 1)` — already set) or remove the field to avoid a false sense of security. **Recommendation: enforce in `TokensService.validateForRequest`.**

**M4. No TOTP 2FA yet** (`User.totpSecret` is a placeholder). For a secrets vault, MFA on login is high-value. Recommend implementing Phase 7 as planned (TOTP, encrypted at rest).

### Low findings
- **L1.** `logout` endpoint is unauthenticated and unthrottled — anyone can POST a guessed refresh token; harmless (only revokes), but add the throttle for consistency.
- **L2.** `@Ip()` behind Render's proxy relies on `trust proxy 1` — correct, but if you deploy behind a different proxy chain, revisit.
- **L3.** `consumeState` sweeps only on new authorizes — expired states linger in memory up to process lifetime; harmless at this volume.
- **L4.** `npm audit` reports 14 vulns (2 critical RCEs in `next` dev chain) — requires Next 16 upgrade; tracked separately.
- **L5.** `bulkImport` loops `upsert` per key (N audit rows, N transactions) — a DoS-ish cost for huge imports; the 1 MB DTO cap and throttles mitigate.

---

## Frontend (apps/web) — findings

### Done right ✅
- Tokens in `localStorage` (XSS-stealable — see below) but the API enforces short access-TTL + rotating refresh, so a stolen access token dies in ≤15 min and a stolen refresh token **revokes itself on first use by the attacker** (rotation) — good damage control.
- `next.config.js`: CSP with explicit script/connect sources, `X-Frame-Options: DENY`, HSTS, `X-Content-Type-Options`.
- `next` param validated same-origin on both login and callback pages (`//` blocked → no open redirect).
- API calls go through the Next rewrite proxy (`/api/*`) — tokens never cross origins, CORS surface minimal.
- React renders text by default (no `dangerouslySetInnerHTML` anywhere) → no stored/reflected XSS vector found.

### Medium
- **M5. Refresh + access tokens in `localStorage`.** Any XSS = full session theft (rotation helps detect, not prevent). The CSP mitigates script injection, but the gold standard is httpOnly cookies for the refresh token. Recommendation for a future hardening pass: move refresh tokens to httpOnly, `SameSite=Strict` cookies set by the API (needs credentials support + CSRF consideration), keep access token in memory only.

### Low
- **L6.** `auth.providers()` and OAuth buttons are fine; the `?next=` flow is properly sanitized.
- **L7.** Pingie widget loads third-party script under CSP `script-src` — pinned to one host; acceptable, but any compromise of that host is script execution on your origin. Consider `self`-hosting or removing if unused.

---

## CLI (packages/cli) — findings

### Done right ✅
- Credentials at `~/.secretforge/credentials.json` with `chmod 600`.
- `SECRETFORGE_URL` vs `SECRETFORGE_TOKEN` confusion guarded (token in URL fails fast with a clear error).
- Proactive refresh 30 s before expiry + one 401 retry; failed refresh wipes stored creds.
- `pull --stdout` and `run` avoid writing plaintext to disk where possible.

### Low
- **L8.** `forge run` injects secrets as **process env vars** — visible in `/proc/<pid>/environ` to the same user and to any child that dumps env; document this (it's the standard trade-off, same as `docker run -e`).
- **L9.** CLI sends the Bearer token to whatever `apiUrl` is stored — if a user re-points `SECRETFORGE_URL` to a malicious host, they hand over their token. Standard for CLIs; the docs warning about trusting URLs is the right mitigation.

---

## SDKs (sdk-node, sdk-python) — findings

### Done right ✅
- Both are service-token-only, read-only by construction (server enforces too — defense in depth).
- Python SDK uses stdlib `urllib` (no extra dependency supply-chain surface), no `verify=False`, no logging of tokens.
- Node SDK never logs values; `.secretforge.json` walk-up resolution is path-safe.

### Low
- **L10.** Neither SDK pins TLS or validates redirect behavior beyond defaults — defaults are safe (system CA store); nothing to change.
- **L11.** `.secretforge.json` in repo + `SECRETFORGE_TOKEN` in CI: document that the token should be a CI-scoped, short-expiry, single-env token (docs already lean this way).

---

## Threat model summary (STRIDE)

| Threat | Status |
|---|---|
| Spoofing | argon2id + OAuth verified-email + hashed rotating tokens ✅ (2FA pending, M4) |
| Tampering | GCM auth tags on every secret + versioned append-only history ✅ |
| Repudiation | Append-only audit log, sanitized, survives project deletion ✅ |
| Info disclosure | **C1 fixed**; values never in audit/logs/URLs; masked lists ✅ |
| DoS | Global + per-route throttles, DTO size caps ✅ (L5 minor) |
| Elevation of privilege | Per-route role guards, read-only tokens, last-admin protections ✅ (M3 ipAllowlist unenforced) |

## Priority actions
1. ✅ **Done:** audit OR bypass fix (C1).
2. **Enforce `ipAllowlist`** on service tokens (M3) — small change, closes a promised-but-missing control.
3. **Move refresh tokens to httpOnly cookies** (M5) — biggest remaining web hardening item.
4. **Implement TOTP 2FA** (M4) — Phase 7 as planned.
5. **Upgrade Next.js** to clear the 2 critical dev-chain RCEs (L4).
6. **Move OAuth state to DB** before ever running >1 API instance (M2).