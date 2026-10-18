import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { base32Decode, hotp } from '../src/auth/totp';
import './setup-e2e';

/**
 * Auth flow e2e: signup → login → refresh rotation → logout → me.
 * Authorization (roles) is covered in projects.e2e-spec.ts.
 */
describe('Auth (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  const email = `alice-${Date.now()}@example.com`;
  const password = 'correct-horse-battery';

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    );
    await app.init();

    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    await app.close();
  });

  it('rejects a weak password at signup', async () => {
    const res = await request(app.getHttpServer())
      .post('/auth/signup')
      .send({ email: `weak-${Date.now()}@example.com`, password: 'short' });
    expect(res.status).toBe(400);
  });

  it('signs up a new user and returns tokens', async () => {
    const res = await request(app.getHttpServer())
      .post('/auth/signup')
      .send({ email, password, name: 'Alice' });
    expect(res.status).toBe(201);
    expect(res.body.accessToken).toBeDefined();
    expect(res.body.refreshToken).toBeDefined();
    expect(res.body.user.email).toBe(email);
    // Password hash must never appear in the response.
    expect(JSON.stringify(res.body)).not.toContain('passwordHash');
  });

  it('rejects duplicate signup', async () => {
    const res = await request(app.getHttpServer())
      .post('/auth/signup')
      .send({ email, password });
    expect(res.status).toBe(409);
  });

  it('logs in with valid credentials', async () => {
    const res = await request(app.getHttpServer()).post('/auth/login').send({ email, password });
    expect(res.status).toBe(200);
    expect(res.body.accessToken).toBeDefined();
    // Web clients authenticate via httpOnly cookies (never JS-readable).
    const cookies = (res.headers['set-cookie'] ?? []) as unknown as string[];
    expect(cookies.some((c) => c.startsWith('sf_access=') && c.includes('HttpOnly'))).toBe(true);
    expect(cookies.some((c) => c.startsWith('sf_refresh=') && c.includes('HttpOnly'))).toBe(true);
  });

  it('rejects a wrong password', async () => {
    const res = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email, password: 'wrong-password-123' });
    expect(res.status).toBe(401);
  });

  it('rejects an unknown email like a wrong password (no user enumeration)', async () => {
    const res = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: `ghost-${Date.now()}@example.com`, password: 'wrong-password-123' });
    expect(res.status).toBe(401);
  });

  it('GET /auth/me requires a token', async () => {
    const res = await request(app.getHttpServer()).get('/auth/me');
    expect(res.status).toBe(401);
  });

  it('GET /auth/me works with a valid token', async () => {
    const login = await request(app.getHttpServer()).post('/auth/login').send({ email, password });
    const res = await request(app.getHttpServer())
      .get('/auth/me')
      .set('Authorization', `Bearer ${login.body.accessToken}`);
    expect(res.status).toBe(200);
    expect(res.body.email).toBe(email);
  });

  it('rotates refresh tokens (old one becomes invalid)', async () => {
    const login = await request(app.getHttpServer()).post('/auth/login').send({ email, password });
    const first = login.body.refreshToken;

    const refresh1 = await request(app.getHttpServer())
      .post('/auth/refresh')
      .send({ refreshToken: first });
    expect(refresh1.status).toBe(200);
    expect(refresh1.body.refreshToken).toBeDefined();
    expect(refresh1.body.refreshToken).not.toBe(first);

    // Replaying the consumed token must fail.
    const replay = await request(app.getHttpServer())
      .post('/auth/refresh')
      .send({ refreshToken: first });
    expect(replay.status).toBe(401);
  });

  it('logs out (refresh token no longer usable)', async () => {
    const login = await request(app.getHttpServer()).post('/auth/login').send({ email, password });
    const { refreshToken } = login.body;

    const out = await request(app.getHttpServer()).post('/auth/logout').send({ refreshToken });
    expect(out.status).toBe(204);

    const refresh = await request(app.getHttpServer())
      .post('/auth/refresh')
      .send({ refreshToken });
    expect(refresh.status).toBe(401);
  });

  it('requires a TOTP code at password login once 2FA is enabled', async () => {
    const totpEmail = `totp-login-${Date.now()}@example.com`;
    const signup = await request(app.getHttpServer())
      .post('/auth/signup')
      .send({ email: totpEmail, password });
    expect(signup.status).toBe(201);
    const token: string = signup.body.accessToken;

    const setup = await request(app.getHttpServer())
      .post('/auth/totp/setup')
      .set('Authorization', `Bearer ${token}`);
    expect(setup.status).toBe(201);
    const secret: string = setup.body.secret;
    const currentCode = () => hotp(base32Decode(secret), Math.floor(Date.now() / 30_000));

    const enable = await request(app.getHttpServer())
      .post('/auth/totp/enable')
      .set('Authorization', `Bearer ${token}`)
      .send({ code: currentCode() });
    expect(enable.status).toBe(200);

    // Password alone is no longer enough — 401 totp_required, no tokens.
    const noCode = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: totpEmail, password });
    expect(noCode.status).toBe(401);
    expect(noCode.body.totp_required).toBe(true);
    expect(noCode.body.accessToken).toBeUndefined();

    // Wrong code rejected…
    const wrongCode = currentCode() === '000000' ? '111111' : '000000';
    const wrong = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: totpEmail, password, totpCode: wrongCode });
    expect(wrong.status).toBe(401);
    expect(wrong.body.totp_required).toBe(true);

    // …right code accepted.
    const ok = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: totpEmail, password, totpCode: currentCode() });
    expect(ok.status).toBe(200);
    expect(ok.body.accessToken).toBeDefined();
  });

  it('stores only hashed refresh tokens in the database', async () => {
    const login = await request(app.getHttpServer()).post('/auth/login').send({ email, password });
    const sessions = await prisma.session.findMany({
      where: { user: { email } },
      orderBy: { createdAt: 'desc' },
      take: 1,
    });
    expect(sessions.length).toBeGreaterThan(0);
    // The stored hash must not be the raw token.
    expect(sessions[0].hashedRefreshToken).not.toBe(login.body.refreshToken);
    expect(sessions[0].hashedRefreshToken).toMatch(/^[a-f0-9]{64}$/); // sha256 hex
  });

  it('runs a full cookie-only session: me → refresh → logout', async () => {
    const jarEmail = `cookie-${Date.now()}@example.com`;
    const pick = (name: string, cs: string[]) => cs.find((c) => c.startsWith(`${name}=`))!.split(';')[0];

    const signup = await request(app.getHttpServer())
      .post('/auth/signup')
      .send({ email: jarEmail, password, name: 'Cookie' });
    expect(signup.status).toBe(201);
    let cookies = (signup.headers['set-cookie'] ?? []) as unknown as string[];
    expect(cookies.some((c) => c.startsWith('sf_access=') && c.includes('HttpOnly'))).toBe(true);
    expect(cookies.some((c) => c.startsWith('sf_refresh=') && c.includes('HttpOnly'))).toBe(true);

    // Cookie-only auth on a guarded route — no Authorization header.
    const me = await request(app.getHttpServer())
      .get('/auth/me')
      .set('Cookie', pick('sf_access', cookies));
    expect(me.status).toBe(200);
    expect(me.body.email).toBe(jarEmail);

    // Refresh with ONLY the refresh cookie → both cookies rotate.
    const refreshed = await request(app.getHttpServer())
      .post('/auth/refresh')
      .set('Cookie', pick('sf_refresh', cookies))
      .send({});
    expect(refreshed.status).toBe(200);
    cookies = (refreshed.headers['set-cookie'] ?? []) as unknown as string[];
    expect(cookies.some((c) => c.startsWith('sf_access='))).toBe(true);
    expect(cookies.some((c) => c.startsWith('sf_refresh='))).toBe(true);

    // Logout with the rotated refresh cookie → both cookies cleared.
    const out = await request(app.getHttpServer())
      .post('/auth/logout')
      .set('Cookie', pick('sf_refresh', cookies))
      .send({});
    expect(out.status).toBe(204);
    const cleared = (out.headers['set-cookie'] ?? []) as unknown as string[];
    expect(cleared.some((c) => c.startsWith('sf_access=') && c.includes('Expires=Thu, 01 Jan 1970'))).toBe(true);
    expect(cleared.some((c) => c.startsWith('sf_refresh=') && c.includes('Expires=Thu, 01 Jan 1970'))).toBe(true);
  });
});
