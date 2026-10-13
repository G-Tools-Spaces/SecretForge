import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import './setup-e2e';

// Configure both providers before the app (and EnvService) boots.
process.env.GOOGLE_CLIENT_ID = 'e2e-google-id';
process.env.GOOGLE_CLIENT_SECRET = 'e2e-google-secret';
process.env.GITHUB_CLIENT_ID = 'e2e-github-id';
process.env.GITHUB_CLIENT_SECRET = 'e2e-github-secret';
process.env.WEB_ORIGIN = 'http://localhost:3000';
process.env.API_PUBLIC_URL = 'http://localhost:4000';

/**
 * Social sign-in e2e. Provider HTTP calls are mocked via global.fetch; the
 * rest of the flow (state, exchange codes, user provisioning, linking) runs
 * against the real API + database.
 */
describe('OAuth (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const realFetch = global.fetch;

  // Mutable provider responses so individual tests can steer the flow.
  let googleProfile: { sub: string; email: string; email_verified: boolean; name?: string };
  let githubUser: { id: number; name: string | null; email: string | null };
  let githubEmails: Array<{ email: string; primary: boolean; verified: boolean }>;

  const googleEmail = `goog-${Date.now()}@example.com`;
  const githubEmail = `gh-${Date.now()}@example.com`;

  beforeAll(async () => {
    googleProfile = { sub: 'g-sub-1', email: googleEmail, email_verified: true, name: 'Google User' };
    githubUser = { id: 4242, name: 'GH User', email: null };
    githubEmails = [{ email: githubEmail, primary: true, verified: true }];

     global.fetch = (async (input: unknown) => {
      const url = String(input);
      const json = (body: unknown, ok = true) => ({ ok, json: async () => body }) as Response;
      if (url === 'https://oauth2.googleapis.com/token') return json({ access_token: 'g-access' });
      if (url === 'https://openidconnect.googleapis.com/v1/userinfo') return json(googleProfile);
      if (url === 'https://github.com/login/oauth/access_token') return json({ access_token: 'gh-access' });
      if (url === 'https://api.github.com/user') return json(githubUser);
      if (url === 'https://api.github.com/user/emails') return json(githubEmails);
      throw new Error(`Unexpected fetch in test: ${url}`);
    }) as typeof fetch;

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    );
    await app.init();
    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    global.fetch = realFetch;
    await app.close();
  });

  /** Run the browser-side of the flow: authorize → callback → exchange code. */
  async function runFlow(provider: 'google' | 'github') {
    const authRes = await request(app.getHttpServer()).get(`/auth/${provider}`).redirects(0);
    expect(authRes.status).toBe(302);
    const authorizeUrl = new URL(authRes.headers.location);
    const state = authorizeUrl.searchParams.get('state')!;

    const cbRes = await request(app.getHttpServer())
      .get(`/auth/${provider}/callback?code=fake-provider-code&state=${state}`)
      .redirects(0);
    expect(cbRes.status).toBe(302);
    const redirect = new URL(cbRes.headers.location);
    return { redirect, state };
  }

  it('reports configured providers', async () => {
    const res = await request(app.getHttpServer()).get('/auth/providers');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ google: true, github: true });
  });

  it('redirects to the provider consent screen with state', async () => {
    const res = await request(app.getHttpServer()).get('/auth/google').redirects(0);
    expect(res.status).toBe(302);
    const url = new URL(res.headers.location);
    expect(url.origin + url.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth');
    expect(url.searchParams.get('client_id')).toBe('e2e-google-id');
    expect(url.searchParams.get('redirect_uri')).toBe('http://localhost:4000/auth/google/callback');
    expect(url.searchParams.get('state')).toBeTruthy();
  });

  it('rejects a callback with a bad state (login CSRF protection)', async () => {
    const res = await request(app.getHttpServer())
      .get('/auth/google/callback?code=x&state=bogus-state')
      .redirects(0);
    expect(res.status).toBe(302);
    const url = new URL(res.headers.location);
    expect(url.pathname).toBe('/auth/callback');
    expect(url.searchParams.get('error')).toBeTruthy();
  });

  it('completes the Google flow: new user, single-use exchange code', async () => {
    const { redirect } = await runFlow('google');
    expect(redirect.origin).toBe('http://localhost:3000');
    expect(redirect.pathname).toBe('/auth/callback');
    const code = redirect.searchParams.get('code')!;

    const exRes = await request(app.getHttpServer()).post('/auth/oauth/exchange').send({ code });
    expect(exRes.status).toBe(200);
    expect(exRes.body.accessToken).toBeDefined();
    expect(exRes.body.refreshToken).toBeDefined();
    expect(exRes.body.user.email).toBe(googleEmail);

    const user = await prisma.user.findUnique({
      where: { email: googleEmail },
      include: { oauthAccounts: true },
    });
    expect(user).not.toBeNull();
    expect(user!.passwordHash).toBeNull(); // OAuth-only account
    expect(user!.oauthAccounts[0].provider).toBe('google');
    expect(user!.oauthAccounts[0].providerAccountId).toBe('g-sub-1');

    // The exchange code is single-use.
    const replay = await request(app.getHttpServer()).post('/auth/oauth/exchange').send({ code });
    expect(replay.status).toBe(401);
  });

  it('rejects a garbage exchange code', async () => {
    const res = await request(app.getHttpServer()).post('/auth/oauth/exchange').send({ code: 'nope' });
    expect(res.status).toBe(401);
  });

  it('links a Google identity to an existing password account by verified email', async () => {
    const email = `link-${Date.now()}@example.com`;
    const signup = await request(app.getHttpServer())
      .post('/auth/signup')
      .send({ email, password: 'correct-horse-battery' });
    expect(signup.status).toBe(201);
    const existingId = signup.body.user.id;

    googleProfile = { sub: 'g-sub-2', email, email_verified: true };
    const { redirect } = await runFlow('google');
    const code = redirect.searchParams.get('code')!;
    const exRes = await request(app.getHttpServer()).post('/auth/oauth/exchange').send({ code });
    expect(exRes.status).toBe(200);
    expect(exRes.body.user.id).toBe(existingId); // same account, now with both sign-in methods

    const links = await prisma.oAuthAccount.count({ where: { userId: existingId, provider: 'google' } });
    expect(links).toBe(1);
  });

  it('rejects an unverified Google email', async () => {
    googleProfile = { sub: 'g-sub-3', email: `unverified-${Date.now()}@example.com`, email_verified: false };
    const { redirect } = await runFlow('google');
    expect(redirect.searchParams.get('error')).toBeTruthy();
    expect(redirect.searchParams.get('code')).toBeNull();
  });

  it('completes the GitHub flow using a verified email from /user/emails', async () => {
    const { redirect } = await runFlow('github');
    const code = redirect.searchParams.get('code')!;
    expect(code).toBeTruthy();

    const exRes = await request(app.getHttpServer()).post('/auth/oauth/exchange').send({ code });
    expect(exRes.status).toBe(200);
    expect(exRes.body.user.email).toBe(githubEmail);

    const user = await prisma.user.findUnique({ where: { email: githubEmail }, include: { oauthAccounts: true } });
    expect(user!.oauthAccounts[0].provider).toBe('github');
    expect(user!.oauthAccounts[0].providerAccountId).toBe('4242');
  });

  it('rejects GitHub sign-in when no verified email exists', async () => {
    githubUser = { id: 9999, name: null, email: null };
    githubEmails = [{ email: `unverified-${Date.now()}@example.com`, primary: true, verified: false }];
    const { redirect } = await runFlow('github');
    expect(redirect.searchParams.get('error')).toBeTruthy();
    expect(redirect.searchParams.get('code')).toBeNull();
  });

  it('carries a safe ?next= through the flow and drops unsafe ones', async () => {
    const authRes = await request(app.getHttpServer())
      .get('/auth/github?next=/invite/abc123')
      .redirects(0);
    const state = new URL(authRes.headers.location).searchParams.get('state')!;
    githubUser = { id: 4242, name: 'GH User', email: null };
    githubEmails = [{ email: githubEmail, primary: true, verified: true }];
    const cbRes = await request(app.getHttpServer())
      .get(`/auth/github/callback?code=x&state=${state}`)
      .redirects(0);
    const redirect = new URL(cbRes.headers.location);
    expect(redirect.searchParams.get('next')).toBe('/invite/abc123');

    const evil = await request(app.getHttpServer()).get('/auth/github?next=//evil.com').redirects(0);
    expect(new URL(evil.headers.location).searchParams.get('state')).toBeTruthy();
    // unsafe next never reaches the state store — callback redirect has no next
    const evilState = new URL(evil.headers.location).searchParams.get('state')!;
    const evilCb = await request(app.getHttpServer())
      .get(`/auth/github/callback?code=x&state=${evilState}`)
      .redirects(0);
    expect(new URL(evilCb.headers.location).searchParams.get('next')).toBeNull();
  });
});
