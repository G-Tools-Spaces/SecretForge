'use client';

/**
 * Browser API client for the SecretForge API.
 * Uses the Next.js rewrite proxy (/api/* → API server) so cookies stay
 * first-party and CORS is a non-issue.
 *
 * Credentials live ONLY in httpOnly SameSite=Strict cookies set by the API
 * (sf_access + sf_refresh) — JavaScript can never read them, so XSS cannot
 * steal tokens. Nothing auth-related is kept in localStorage.
 */

const API_BASE = '/api';

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    /** True when the API demands a TOTP code (2FA enabled on the account). */
    public totpRequired?: boolean,
  ) {
    super(message);
  }
}

/**
 * Rotate the session via the httpOnly refresh cookie — on success the API
 * sets a fresh access cookie. Returns false when the session is gone for
 * good (the user must log in again). Cookies ride same-origin automatically,
 * so no `credentials` option is needed.
 */
async function refreshSession(): Promise<boolean> {
  try {
    const res = await fetch(`${API_BASE}/auth/refresh`, { method: 'POST' });
    return res.ok;
  } catch {
    return false;
  }
}

export async function api<T = unknown>(path: string, init: RequestInit = {}): Promise<T> {
  const send = () =>
    fetch(`${API_BASE}${path}`, {
      ...init,
      headers: {
        'content-type': 'application/json',
        ...(init.headers ?? {}),
      },
    });

  let res = await send();

  // Access cookie missing/expired → rotate via the refresh cookie, retry once.
  if (res.status === 401 && (await refreshSession())) {
    res = await send();
  }

  if (!res.ok) {
    let message = `Request failed (${res.status})`;
    try {
      const body = await res.json();
      if (body?.message) message = body.message;
    } catch {
      /* non-JSON */
    }
    throw new ApiError(res.status, message);
  }

  if (res.status === 204) return undefined as T;
  return res.json();
}

// ── Typed API shapes ────────────────────────────────────────────────────────

export interface Me {
  id: string;
  email: string;
  name: string | null;
  createdAt: string;
}

export interface Org {
  id: string;
  name: string;
  slug: string;
  members?: Array<{ userId: string; role: string; user: { id: string; email: string; name: string | null } }>;
  projects?: Array<{ id: string; name: string; slug: string; createdAt: string }>;
  _count?: { projects: number };
}

export interface OrgMemberRow {
  userId: string;
  role: string;
  user: { id: string; email: string; name: string | null };
}

export interface OrgDetail {
  id: string;
  name: string;
  slug: string;
  members: OrgMemberRow[];
  projects: Array<{ id: string; name: string; slug: string; createdAt: string }>;
}

export interface OrgInvite {
  id: string;
  email: string;
  role: string;
  expiresAt: string;
  token?: string; // present only right after creation
}

export interface InvitePreview {
  orgName: string;
  role: string;
  emailMasked: string;
  expiresAt: string;
}

export interface Project {
  id: string;
  name: string;
  slug: string;
  orgId: string;
  org: { id: string; name: string; slug: string };
  environments: Array<{ id: string; name: string }>;
  members?: Array<{ userId: string; role: string; user: { id: string; email: string; name: string | null } }>;
  yourRole?: string;
  _count?: { members: number };
}

/** Secret identity inside an environment: "" group = ungrouped. */
export interface SecretRef {
  group: string;
  key: string;
}

/** `?group=…` query suffix for secret routes (empty for ungrouped). */
export const groupQuery = (group: string): string =>
  group ? `?group=${encodeURIComponent(group)}` : '';

/** Display label: `backend/PORT` or just `PORT`. */
export const refLabel = ({ group, key }: SecretRef): string => (group ? `${group}/${key}` : key);

export interface SecretRow {
  id: string;
  group: string;
  key: string;
  version: number;
  rotatedAt: string;
  updatedAt: string;
  createdAt: string;
}

export interface ServiceTokenInfo {
  id: string;
  name: string;
  environment: string;
  prefix: string | null;
  scope: string;
  expiresAt: string;
  revokedAt: string | null;
  lastUsedAt: string | null;
  createdAt: string;
}

export interface CreatedToken {
  id: string;
  name: string;
  environment: string;
  token: string; // plaintext — shown exactly once
  expiresAt: string;
}

export interface AuditEntry {
  id: string;
  action: string;
  resource: string;
  ip: string | null;
  createdAt: string;
  meta: Record<string, unknown> | null;
  user: { id: string; email: string; name: string | null } | null;
}

export const auth = {
  async login(email: string, password: string, totpCode?: string) {
    const res = await fetch(`${API_BASE}/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password, ...(totpCode ? { totpCode } : {}) }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => null);
      throw new ApiError(res.status, body?.message ?? 'Login failed', body?.totp_required === true);
    }
    const body = await res.json();
    // Both tokens arrive as httpOnly cookies — nothing to store in JS.
    return body.user as Me;
  },
  async signup(email: string, password: string, name?: string) {
    const res = await fetch(`${API_BASE}/auth/signup`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password, name }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => null);
      throw new ApiError(res.status, body?.message ?? 'Signup failed');
    }
    const body = await res.json();
    return body.user as Me;
  },
  /** Which social sign-in providers the API has configured. */
  async providers(): Promise<{ google: boolean; github: boolean }> {
    try {
      const res = await fetch(`${API_BASE}/auth/providers`);
      if (!res.ok) return { google: false, github: false };
      return (await res.json()) as { google: boolean; github: boolean };
    } catch {
      return { google: false, github: false };
    }
  },
  /** Redeem the single-use code from the OAuth callback redirect. */
  async exchangeOAuthCode(code: string, totpCode?: string) {
    const res = await fetch(`${API_BASE}/auth/oauth/exchange`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ code, ...(totpCode ? { totpCode } : {}) }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => null);
      throw new ApiError(res.status, body?.message ?? 'Social sign-in failed', body?.totp_required === true);
    }
    const body = await res.json();
    return body.user as Me;
  },
  logout() {
    // The httpOnly cookies ride along; the API revokes the session and
    // clears both cookies. Fire-and-forget — local state resets regardless.
    fetch(`${API_BASE}/auth/logout`, { method: 'POST' }).catch(() => {});
  },
};
