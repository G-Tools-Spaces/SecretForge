import { BadRequestException, Injectable, UnauthorizedException } from '@nestjs/common';
import { createHash, randomBytes } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { EnvService } from '../config/env.service';
import { AuditService } from '../audit/audit.service';
import { AuthService, TokenPair } from './auth.service';

export type OAuthProvider = 'google' | 'github';

interface OAuthProfile {
  providerAccountId: string;
  email: string;
  name: string | null;
}

/** Normalized callback result handed to the controller for the web redirect. */
export interface OAuthCallbackResult {
  exchangeCode: string;
  next?: string;
}

const STATE_TTL_MS = 10 * 60 * 1000;
const EXCHANGE_CODE_TTL_MS = 60 * 1000;

/**
 * Social sign-in (Google / GitHub) with zero extra dependencies — plain
 * OAuth 2.0 authorization-code flow over fetch:
 *
 *   browser → GET /auth/<provider>            → 302 to the provider consent screen
 *   provider → GET /auth/<provider>/callback  → code exchanged server-side,
 *            user found/created, single-use exchange code issued,
 *            302 to WEB_ORIGIN/auth/callback?code=…
 *   browser → POST /auth/oauth/exchange       → real access+refresh tokens
 *
 * Security notes:
 *  - `state` is a single-use random value with a 10-minute TTL (login CSRF).
 *  - Emails are only trusted when the provider marks them verified.
 *  - Exchange codes are stored as SHA-256 hashes, single-use, 60-second TTL,
 *    so real tokens never appear in URLs, history or access logs.
 *  - Linking by email is safe: both providers verify ownership of the address.
 */
@Injectable()
export class OAuthService {
  /** state → { expiresAt, next } — in-memory is fine for a single-instance deployment. */
  private readonly states = new Map<string, { expiresAt: number; next?: string }>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly env: EnvService,
    private readonly audit: AuditService,
    private readonly auth: AuthService,
  ) {}

  isEnabled(provider: OAuthProvider): boolean {
    return provider === 'google' ? this.env.googleEnabled : this.env.githubEnabled;
  }

  private redirectUri(provider: OAuthProvider): string {
    return `${this.env.apiPublicUrl}/auth/${provider}/callback`;
  }

  /** Build the provider consent-screen URL and remember the state. */
  authorizeUrl(provider: OAuthProvider, next?: string): string {
    const state = randomBytes(16).toString('hex');
    this.states.set(state, { expiresAt: Date.now() + STATE_TTL_MS, next });
    this.sweepStates();

    const params = new URLSearchParams({
      client_id: provider === 'google' ? this.env.googleClientId : this.env.githubClientId,
      redirect_uri: this.redirectUri(provider),
      state,
      response_type: 'code',
    });

    if (provider === 'google') {
      params.set('scope', 'openid email profile');
      params.set('access_type', 'online');
      return `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
    }
    params.set('scope', 'read:user user:email');
    return `https://github.com/login/oauth/authorize?${params}`;
  }

  /** Validate + consume a state value (single-use). Returns the stored `next`. */
  consumeState(state: string): { next?: string } {
    const entry = this.states.get(state);
    this.states.delete(state);
    if (!entry || entry.expiresAt < Date.now()) {
      throw new BadRequestException('Invalid or expired OAuth state — please try signing in again');
    }
    return { next: entry.next };
  }

  private sweepStates() {
    const now = Date.now();
    for (const [key, value] of this.states) {
      if (value.expiresAt < now) this.states.delete(key);
    }
  }

  /** Exchange the provider code for a profile, find/create the user, issue an exchange code. */
  async handleCallback(provider: OAuthProvider, code: string, ip?: string): Promise<OAuthCallbackResult & { next?: string }> {
    const profile = await this.fetchProfile(provider, code);
    const user = await this.findOrCreateUser(provider, profile, ip);

    const exchangeCode = randomBytes(32).toString('base64url');
    await this.prisma.oAuthExchangeCode.create({
      data: {
        codeHash: createHash('sha256').update(exchangeCode).digest('hex'),
        userId: user.id,
        expiresAt: new Date(Date.now() + EXCHANGE_CODE_TTL_MS),
      },
    });

    return { exchangeCode };
  }

  /** Redeem a single-use exchange code for a real token pair. */
  async exchange(code: string, ip?: string): Promise<TokenPair & { user: { id: string; email: string; name: string | null } }> {
    const codeHash = createHash('sha256').update(code).digest('hex');
    const row = await this.prisma.oAuthExchangeCode.findUnique({
      where: { codeHash },
      include: { user: true },
    });

    if (!row || row.consumedAt || row.expiresAt < new Date()) {
      throw new UnauthorizedException('This sign-in code is invalid or has expired — please try again');
    }

    await this.prisma.oAuthExchangeCode.update({
      where: { id: row.id },
      data: { consumedAt: new Date() },
    });

    const tokens = await this.auth.issueTokens(row.user.id, row.user.email, 'oauth', ip);

    await this.audit.record({
      action: 'USER_LOGIN',
      userId: row.user.id,
      resource: `user/${row.user.id}`,
      ip,
      meta: { device: 'oauth' },
    });

    return { ...tokens, user: { id: row.user.id, email: row.user.email, name: row.user.name } };
  }

  /**
   * Resolve the local user for a provider profile:
   * existing identity link → existing user with the same (verified) email → new user.
   */
  private async findOrCreateUser(provider: OAuthProvider, profile: OAuthProfile, ip?: string) {
    const email = profile.email.toLowerCase();

    const linked = await this.prisma.oAuthAccount.findUnique({
      where: { provider_providerAccountId: { provider, providerAccountId: profile.providerAccountId } },
      include: { user: true },
    });
    if (linked) return linked.user;

    const existing = await this.prisma.user.findUnique({ where: { email } });
    if (existing) {
      await this.prisma.oAuthAccount.create({
        data: { userId: existing.id, provider, providerAccountId: profile.providerAccountId, email },
      });
      return existing;
    }

    const user = await this.prisma.user.create({
      data: {
        email,
        name: profile.name,
        passwordHash: null, // OAuth-only account — no password
        oauthAccounts: {
          create: { provider, providerAccountId: profile.providerAccountId, email },
        },
      },
    });

    await this.audit.record({
      action: 'USER_SIGNUP',
      userId: user.id,
      resource: `user/${user.id}`,
      ip,
      meta: { provider },
    });

    return user;
  }

  /** Server-side code exchange + profile fetch, normalized per provider. */
  private async fetchProfile(provider: OAuthProvider, code: string): Promise<OAuthProfile> {
    try {
      return provider === 'google' ? await this.fetchGoogleProfile(code) : await this.fetchGithubProfile(code);
    } catch (err) {
      if (err instanceof BadRequestException) throw err;
      throw new BadRequestException(`Could not verify your ${provider === 'google' ? 'Google' : 'GitHub'} sign-in`);
    }
  }

  private async fetchGoogleProfile(code: string): Promise<OAuthProfile> {
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: this.env.googleClientId,
        client_secret: this.env.googleClientSecret,
        code,
        grant_type: 'authorization_code',
        redirect_uri: this.redirectUri('google'),
      }),
    });
    if (!tokenRes.ok) throw new BadRequestException('Google rejected the sign-in code');
    const token = (await tokenRes.json()) as { access_token?: string };
    if (!token.access_token) throw new BadRequestException('Google returned no access token');

    const profileRes = await fetch('https://openidconnect.googleapis.com/v1/userinfo', {
      headers: { authorization: `Bearer ${token.access_token}` },
    });
    if (!profileRes.ok) throw new BadRequestException('Could not fetch your Google profile');
    const profile = (await profileRes.json()) as {
      sub?: string;
      email?: string;
      email_verified?: boolean;
      name?: string;
    };

    if (!profile.sub || !profile.email || profile.email_verified !== true) {
      throw new BadRequestException('Your Google account has no verified email address');
    }
    return { providerAccountId: profile.sub, email: profile.email, name: profile.name ?? null };
  }

  private async fetchGithubProfile(code: string): Promise<OAuthProfile> {
    const tokenRes = await fetch('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({
        client_id: this.env.githubClientId,
        client_secret: this.env.githubClientSecret,
        code,
        redirect_uri: this.redirectUri('github'),
      }),
    });
    if (!tokenRes.ok) throw new BadRequestException('GitHub rejected the sign-in code');
    const token = (await tokenRes.json()) as { access_token?: string };
    if (!token.access_token) throw new BadRequestException('GitHub returned no access token');

    const headers = {
      authorization: `Bearer ${token.access_token}`,
      accept: 'application/vnd.github+json',
      'user-agent': 'secretforge',
    };
    const userRes = await fetch('https://api.github.com/user', { headers });
    if (!userRes.ok) throw new BadRequestException('Could not fetch your GitHub profile');
    const ghUser = (await userRes.json()) as { id?: number; name?: string | null; email?: string | null };
    if (!ghUser.id) throw new BadRequestException('GitHub returned an incomplete profile');

    // The email is private on many accounts — fall back to /user/emails and
    // only accept an address GitHub has verified.
    let email = ghUser.email ?? null;
    if (!email) {
      const emailsRes = await fetch('https://api.github.com/user/emails', { headers });
      if (emailsRes.ok) {
        const emails = (await emailsRes.json()) as Array<{ email: string; primary: boolean; verified: boolean }>;
        email =
          emails.find((e) => e.primary && e.verified)?.email ??
          emails.find((e) => e.verified)?.email ??
          null;
      }
    }
    if (!email) {
      throw new BadRequestException('Your GitHub account has no verified email address');
    }
    return { providerAccountId: String(ghUser.id), email, name: ghUser.name ?? null };
  }
}
