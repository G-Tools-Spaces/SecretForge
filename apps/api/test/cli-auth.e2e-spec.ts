import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import './setup-e2e';

process.env.WEB_ORIGIN = 'http://localhost:3000';

/**
 * Browser-based CLI login e2e (`forge login`): start redirect, code minting
 * (authed), code exchange (single-use, expiring) — including the OAuth-only
 * account case (passwordHash = null), which is the whole point of the flow.
 */
describe('CLI auth (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let jwt: JwtService;

  const email = `cli-${Date.now()}@example.com`;
  const password = 'correct-horse-battery';
  let accessToken: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    );
    await app.init();
    prisma = app.get(PrismaService);
    jwt = app.get(JwtService);

    await prisma.user.deleteMany({ where: { email: { startsWith: 'cli-' } } });

    const signup = await request(app.getHttpServer())
      .post('/auth/signup')
      .send({ email, password });
    accessToken = signup.body.accessToken;
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET /auth/cli/start redirects to the web app with port + state', async () => {
    const res = await request(app.getHttpServer())
      .get('/auth/cli/start?port=54321&state=abcdef0123456789')
      .redirects(0);
    expect(res.status).toBe(302);
    const target = new URL(res.headers.location);
    expect(target.origin).toBe('http://localhost:3000');
    expect(target.pathname).toBe('/cli-auth');
    expect(target.searchParams.get('port')).toBe('54321');
    expect(target.searchParams.get('state')).toBe('abcdef0123456789');
  });

  it('GET /auth/cli/start rejects bad params', async () => {
    const badPort = await request(app.getHttpServer())
      .get('/auth/cli/start?port=abc&state=abcdef0123456789')
      .redirects(0);
    expect(badPort.status).toBe(400);

    const badState = await request(app.getHttpServer())
      .get('/auth/cli/start?port=1234&state=not-hex!')
      .redirects(0);
    expect(badState.status).toBe(400);
  });

  it('POST /auth/cli/authorize requires a signed-in user', async () => {
    const res = await request(app.getHttpServer()).post('/auth/cli/authorize');
    expect(res.status).toBe(401);
  });

  it('mints a code and exchanges it for tokens (single-use)', async () => {
    const authz = await request(app.getHttpServer())
      .post('/auth/cli/authorize')
      .set('Authorization', `Bearer ${accessToken}`);
    expect(authz.status).toBe(201);
    const code: string = authz.body.code;
    expect(code).toBeTruthy();

    const ex = await request(app.getHttpServer()).post('/auth/cli/exchange').send({ code });
    expect(ex.status).toBe(200);
    expect(ex.body.accessToken).toBeDefined();
    expect(ex.body.refreshToken).toBeDefined();
    expect(ex.body.user.email).toBe(email);

    // Single-use.
    const replay = await request(app.getHttpServer()).post('/auth/cli/exchange').send({ code });
    expect(replay.status).toBe(401);
  });

  it('rejects a garbage code', async () => {
    const res = await request(app.getHttpServer()).post('/auth/cli/exchange').send({ code: 'nope' });
    expect(res.status).toBe(401);
  });

  it('rejects an expired code', async () => {
    const authz = await request(app.getHttpServer())
      .post('/auth/cli/authorize')
      .set('Authorization', `Bearer ${accessToken}`);
    const code: string = authz.body.code;

    // Force expiry.
    await prisma.cliAuthCode.updateMany({
      where: { user: { email } },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });

    const res = await request(app.getHttpServer()).post('/auth/cli/exchange').send({ code });
    expect(res.status).toBe(401);
  });

  it('works for OAuth-only accounts (passwordHash = null)', async () => {
    // The bug this flow fixes: social-sign-in users have no password, so the
    // old email+password CLI login could never work for them.
    const oauthEmail = `cli-oauth-${Date.now()}@example.com`;
    const user = await prisma.user.create({ data: { email: oauthEmail, passwordHash: null } });
    const token = await jwt.signAsync({ sub: user.id, email: user.email });

    const authz = await request(app.getHttpServer())
      .post('/auth/cli/authorize')
      .set('Authorization', `Bearer ${token}`);
    expect(authz.status).toBe(201);

    const ex = await request(app.getHttpServer())
      .post('/auth/cli/exchange')
      .send({ code: authz.body.code });
    expect(ex.status).toBe(200);
    expect(ex.body.user.email).toBe(oauthEmail);
  });
});
