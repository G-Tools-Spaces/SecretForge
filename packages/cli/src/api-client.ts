import {
  Credentials,
  clearCredentials,
  defaultApiUrl,
  loadCredentials,
  saveCredentials,
} from './config';

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly body?: unknown,
  ) {
    super(message);
  }
}

/** Decode the `exp` claim from a JWT without verifying (verification is the API's job). */
export function decodeJwtExp(token: string): number | null {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  try {
    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
    return typeof payload.exp === 'number' ? payload.exp : null;
  } catch {
    return null;
  }
}

/**
 * Minimal authenticated API client.
 *
 *  - Sends the stored access token as a Bearer token.
 *  - SECRETFORGE_TOKEN env var (service tokens, Phase 6) overrides user creds.
 *  - Proactively refreshes when the access token is within 30s of expiry, and
 *    retries once on 401. Refreshed tokens are persisted back to disk.
 */
export class ApiClient {
  private creds: Credentials | null;

  constructor(creds: Credentials | null) {
    this.creds = creds;
  }

  /** Load credentials; returns null if not logged in. */
  static fromStored(): ApiClient {
    return new ApiClient(loadCredentials());
  }

  get apiUrl(): string {
    return this.creds?.apiUrl ?? '';
  }

  get isLoggedIn(): boolean {
    return this.creds !== null;
  }

  /** Store fresh credentials (after login/refresh). */
  setCredentials(creds: Credentials): void {
    this.creds = creds;
    saveCredentials(creds);
  }

  logoutLocally(): void {
    clearCredentials();
    this.creds = null;
  }

  private async doFetch(path: string, init: RequestInit, token: string): Promise<Response> {
    return fetch(`${this.apiUrl}${path}`, {
      ...init,
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${token}`,
        ...(init.headers ?? {}),
      },
    });
  }

  private async ensureFreshToken(): Promise<string> {
    if (!this.creds) throw new ApiError(401, 'Not logged in. Run `forge login` first.');
    const exp = decodeJwtExp(this.creds.accessToken);
    const expiringSoon = exp !== null && exp * 1000 < Date.now() + 30_000;

    if (exp === null || expiringSoon) {
      await this.refreshTokens();
    }
    return this.creds.accessToken;
  }

  private async refreshTokens(): Promise<void> {
    if (!this.creds) throw new ApiError(401, 'Not logged in. Run `forge login` first.');
    const res = await fetch(`${this.apiUrl}/auth/refresh`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ refreshToken: this.creds.refreshToken }),
    });
    if (!res.ok) {
      this.logoutLocally();
      throw new ApiError(401, 'Session expired. Run `forge login` again.');
    }
    const body = (await res.json()) as { accessToken: string; refreshToken: string };
    this.setCredentials({ ...this.creds, accessToken: body.accessToken, refreshToken: body.refreshToken });
  }

  /** Authenticated JSON request with auto-refresh + one 401 retry. */
  async request<T = unknown>(path: string, init: RequestInit = {}): Promise<T> {
    let token = await this.ensureFreshToken();
    let res = await this.doFetch(path, init, token);

    if (res.status === 401) {
      // Access token rejected (e.g. rotated server-side) — refresh and retry once.
      await this.refreshTokens();
      token = this.creds!.accessToken;
      res = await this.doFetch(path, init, token);
    }

    if (!res.ok) {
      let message = `API error ${res.status}`;
      let body: unknown;
      try {
        body = await res.json();
        if (body && typeof body === 'object' && 'message' in body) {
          message = String((body as { message: unknown }).message);
        }
      } catch {
        /* non-JSON error body */
      }
      throw new ApiError(res.status, message, body);
    }

    if (res.status === 204) return undefined as T;
    return (await res.json()) as T;
  }

  get<T = unknown>(path: string): Promise<T> {
    return this.request<T>(path, { method: 'GET' });
  }

  post<T = unknown>(path: string, body?: unknown): Promise<T> {
    return this.request<T>(path, { method: 'POST', body: body ? JSON.stringify(body) : undefined });
  }

  put<T = unknown>(path: string, body: unknown): Promise<T> {
    return this.request<T>(path, { method: 'PUT', body: JSON.stringify(body) });
  }

  delete<T = unknown>(path: string): Promise<T> {
    return this.request<T>(path, { method: 'DELETE' });
  }
}

/**
 * Resolve the client for a command:
 *  1. SECRETFORGE_TOKEN (service token / CI) wins if set.
 *  2. Otherwise stored user credentials.
 * Exits with a friendly message if neither is available.
 */
export function requireClient(): ApiClient {
  const serviceToken = process.env.SECRETFORGE_TOKEN;
  if (serviceToken) {
    const client = new ApiClient(null);
    // Service tokens are pre-authorized; wrap them as a non-expiring credential.
    (client as unknown as { creds: Credentials }).creds = {
      apiUrl: defaultApiUrl(),
      email: 'service-token',
      accessToken: serviceToken,
      refreshToken: '',
    };
    return client;
  }

  const client = ApiClient.fromStored();
  if (!client.isLoggedIn) {
    console.error('Not logged in. Run `forge login` first.');
    process.exit(1);
  }
  return client;
}
