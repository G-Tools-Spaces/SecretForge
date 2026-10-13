'use client';

/**
 * Browser API client for the SecretForge API.
 * Uses the Next.js rewrite proxy (/api/* → API server) so cookies stay
 * first-party and CORS is a non-issue.
 */

const API_BASE = '/api';

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

let accessToken: string | null = null;

export function setAccessToken(token: string | null) {
  accessToken = token;
}

export function getAccessToken(): string | null {
  if (accessToken) return accessToken;
  if (typeof window !== 'undefined') {
    accessToken = localStorage.getItem('sf_access_token');
  }
  return accessToken;
}

async function refreshAccessToken(): Promise<string | null> {
  const refreshToken = localStorage.getItem('sf_refresh_token');
  if (!refreshToken) return null;
  try {
    const res = await fetch(`${API_BASE}/auth/refresh`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ refreshToken }),
    });
    if (!res.ok) return null;
    const body = await res.json();
    localStorage.setItem('sf_access_token', body.accessToken);
    localStorage.setItem('sf_refresh_token', body.refreshToken);
    accessToken = body.accessToken;
    return body.accessToken;
  } catch {
    return null;
  }
}

export async function api<T = unknown>(path: string, init: RequestInit = {}): Promise<T> {
  let token = getAccessToken();
  if (!token) {
    token = await refreshAccessToken();
    if (!token) throw new ApiError(401, 'Not logged in');
  }

  let res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${token}`,
      ...(init.headers ?? {}),
    },
  });

  if (res.status === 401) {
    token = await refreshAccessToken();
    if (!token) throw new ApiError(401, 'Not logged in');
    res = await fetch(`${API_BASE}${path}`, {
      ...init,
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${token}`,
        ...(init.headers ?? {}),
      },
    });
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

export interface SecretRow {
  id: string;
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
  async login(email: string, password: string) {
    const res = await fetch(`${API_BASE}/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => null);
      throw new ApiError(res.status, body?.message ?? 'Login failed');
    }
    const body = await res.json();
    localStorage.setItem('sf_access_token', body.accessToken);
    localStorage.setItem('sf_refresh_token', body.refreshToken);
    accessToken = body.accessToken;
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
    localStorage.setItem('sf_access_token', body.accessToken);
    localStorage.setItem('sf_refresh_token', body.refreshToken);
    accessToken = body.accessToken;
    return body.user as Me;
  },
  logout() {
    const refreshToken = localStorage.getItem('sf_refresh_token');
    if (refreshToken) {
      fetch(`${API_BASE}/auth/logout`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ refreshToken }),
      }).catch(() => {});
    }
    localStorage.removeItem('sf_access_token');
    localStorage.removeItem('sf_refresh_token');
    accessToken = null;
  },
};
