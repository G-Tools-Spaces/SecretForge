import { Response } from 'express';

/**
 * Review M5: refresh tokens move from localStorage to an httpOnly cookie.
 *
 *  - httpOnly → JavaScript (and therefore XSS) can never read it.
 *  - SameSite=Strict → never sent on cross-site requests (CSRF).
 *  - Secure → HTTPS-only in production (allowed over http on localhost
 *    for development).
 *
 * The cookies are set by the API on login/signup/refresh/oauth-exchange and
 * cleared on logout. BOTH credentials are httpOnly — JavaScript (and thus
 * XSS) can read neither. A stolen access cookie dies in ≤15 min and a
 * stolen refresh cookie is revoked on first rotation.
 */
export const REFRESH_COOKIE = 'sf_refresh';

/** Short-lived access-token cookie (the JWT) — the web app's session credential. */
export const ACCESS_COOKIE = 'sf_access';

/**
 * Access-cookie lifetime. The JWT's own `exp` is the real enforcement
 * (default 15m — see ACCESS_TOKEN_TTL); the cookie maxAge mirrors it so the
 * browser drops a dead token instead of keeping it around.
 */
export const ACCESS_COOKIE_MAX_AGE_MS = 15 * 60 * 1000;

/** Cookie options; `secure` only in production so local dev over http works. */
export function refreshCookieOptions(maxAgeMs: number) {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict' as const,
    // '/' rather than '/auth': the web app proxies /api/* to this API, so the
    // browser-visible paths are /api/auth/... — a narrow path would never match.
    path: '/',
    maxAge: maxAgeMs,
  };
}

/** Read one cookie from a raw cookie header (no cookie-parser dependency). */
export function readCookie(req: { headers: { cookie?: string } }, name: string): string | undefined {
  const header = req.headers.cookie;
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const [k, ...rest] = part.trim().split('=');
    if (k === name) return decodeURIComponent(rest.join('='));
  }
  return undefined;
}

/** Set the refresh cookie on a response (passthrough mode). */
export function setRefreshCookie(res: Response, token: string, maxAgeMs: number): void {
  res.cookie(REFRESH_COOKIE, token, refreshCookieOptions(maxAgeMs));
}

/** Clear the refresh cookie. */
export function clearRefreshCookie(res: Response): void {
  res.clearCookie(REFRESH_COOKIE, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict' as const,
    path: '/',
  });
}

/** Set the short-lived access cookie on a response (passthrough mode). */
export function setAccessCookie(res: Response, token: string, maxAgeMs: number): void {
  res.cookie(ACCESS_COOKIE, token, refreshCookieOptions(maxAgeMs));
}

/** Clear the access cookie. */
export function clearAccessCookie(res: Response): void {
  res.clearCookie(ACCESS_COOKIE, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict' as const,
    path: '/',
  });
}
