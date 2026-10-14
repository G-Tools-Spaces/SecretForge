import { Response } from 'express';

/**
 * Review M5: refresh tokens move from localStorage to an httpOnly cookie.
 *
 *  - httpOnly → JavaScript (and therefore XSS) can never read it.
 *  - SameSite=Strict → never sent on cross-site requests (CSRF).
 *  - Secure → HTTPS-only in production (allowed over http on localhost
 *    for development).
 *
 * The cookie is set by the API on login/signup/refresh/oauth-exchange and
 * cleared on logout. The web app keeps ONLY the short-lived access token
 * in memory/localStorage — a stolen access token dies in ≤15 min and a
 * stolen refresh cookie is revoked on first rotation.
 */
export const REFRESH_COOKIE = 'sf_refresh';

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
