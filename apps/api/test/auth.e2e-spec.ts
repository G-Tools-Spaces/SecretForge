import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
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
});
