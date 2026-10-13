import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import './setup-e2e';

/**
 * Phase 2 e2e: secrets CRUD, versioning, rollback, bulk import/export,
 * role matrix (READ/WRITE/ADMIN), and encryption-at-rest verification.
 */
describe('Secrets (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  let adminToken: string;   // project ADMIN (Alice)
  let writeToken: string;   // project WRITE  (Bob)
  let readToken: string;    // project READ   (Carol)
  let outsiderToken: string; // org member, no project access (Dave)
  let projectId: string;
  let envId: string;

  const uniq = Date.now();
  const SECRET_VALUE_V1 = 'sk_test_v1_SUPER_SECRET';
  const SECRET_VALUE_V2 = 'sk_test_v2_ROTATED';

  async function signup(email: string): Promise<string> {
    const res = await request(app.getHttpServer())
      .post('/auth/signup')
      .send({ email, password: 'correct-horse-battery' });
    return res.body.accessToken;
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    );
    await app.init();
    prisma = app.get(PrismaService);

    // Users
    adminToken = await signup(`admin-s-${uniq}@example.com`);
    writeToken = await signup(`writer-s-${uniq}@example.com`);
    readToken = await signup(`reader-s-${uniq}@example.com`);
    outsiderToken = await signup(`outsider-s-${uniq}@example.com`);

    // Org + invite everyone
    const org = await request(app.getHttpServer())
      .post('/orgs')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: `Secrets Org ${uniq}` });
    const orgId = org.body.id;

    const emails = [
      [writeToken, `writer-s-${uniq}@example.com`],
      [readToken, `reader-s-${uniq}@example.com`],
      [outsiderToken, `outsider-s-${uniq}@example.com`],
    ] as const;
    for (const [token, email] of emails) {
      const invite = await request(app.getHttpServer())
        .post(`/orgs/${orgId}/invite`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ email });
      await request(app.getHttpServer())
        .post(`/orgs/${orgId}/invites/accept`)
        .set('Authorization', `Bearer ${token}`)
        .send({ token: invite.body.token });
    }

    // Project
    const project = await request(app.getHttpServer())
      .post('/projects')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ orgId, name: `secrets-app ${uniq}` });
    projectId = project.body.id;

    // Add members with roles
    for (const [token, role] of [
      [writeToken, 'WRITE'],
      [readToken, 'READ'],
    ] as const) {
      const me = await request(app.getHttpServer())
        .get('/auth/me')
        .set('Authorization', `Bearer ${token}`);
      await request(app.getHttpServer())
        .post(`/projects/${projectId}/members`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ userId: me.body.id, role });
    }

    const env = await prisma.environment.findUnique({
      where: { projectId_name: { projectId, name: 'dev' } },
    });
    envId = env!.id;
  });

  afterAll(async () => {
    await app.close();
  });

  // ── Write path ────────────────────────────────────────────────────────────

  it('ADMIN can upsert a secret', async () => {
    const res = await request(app.getHttpServer())
      .put(`/projects/${projectId}/envs/dev/secrets/STRIPE_KEY`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ value: SECRET_VALUE_V1 });
    expect(res.status).toBe(200);
    expect(res.body.version).toBe(1);
    expect(res.body.createdAt).toBe(true);
  });

  it('WRITE can upsert a secret', async () => {
    const res = await request(app.getHttpServer())
      .put(`/projects/${projectId}/envs/dev/secrets/DATABASE_URL`)
      .set('Authorization', `Bearer ${writeToken}`)
      .send({ value: 'postgres://u:p@localhost/db' });
    expect(res.status).toBe(200);
  });

  it('READ cannot upsert a secret', async () => {
    const res = await request(app.getHttpServer())
      .put(`/projects/${projectId}/envs/dev/secrets/NOPE`)
      .set('Authorization', `Bearer ${readToken}`)
      .send({ value: 'x' });
    expect(res.status).toBe(403);
  });

  it('rejects invalid secret keys', async () => {
    const res = await request(app.getHttpServer())
      .put(`/projects/${projectId}/envs/dev/secrets/1BAD-KEY`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ value: 'x' });
    expect(res.status).toBe(400);
  });

  it('rejects empty values', async () => {
    const res = await request(app.getHttpServer())
      .put(`/projects/${projectId}/envs/dev/secrets/EMPTY`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ value: '' });
    expect(res.status).toBe(400);
  });

  it('rejects unknown environments', async () => {
    const res = await request(app.getHttpServer())
      .put(`/projects/${projectId}/envs/nonexistent/secrets/KEY`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ value: 'x' });
    expect(res.status).toBe(404);
  });

  // ── Encryption at rest ────────────────────────────────────────────────────

  it('stores only ciphertext in the database (never plaintext)', async () => {
    const rows = await prisma.secret.findMany({ where: { environmentId: envId } });
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row.encryptedValue).not.toContain('postgres://');
      expect(row.encryptedValue).not.toBe('x');
      // Must be valid base64.
      expect(() => Buffer.from(row.encryptedValue, 'base64')).not.toThrow();
    }
    const raw = JSON.stringify(rows);
    expect(raw).not.toContain(SECRET_VALUE_V1);
    expect(raw).not.toContain('postgres://u:p@localhost/db');
  });

  it('uses a unique IV per version', async () => {
    await request(app.getHttpServer())
      .put(`/projects/${projectId}/envs/dev/secrets/STRIPE_KEY`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ value: SECRET_VALUE_V2 });
    const versions = await prisma.secretVersion.findMany({
      where: { secret: { key: 'STRIPE_KEY' } },
      orderBy: { version: 'asc' },
    });
    expect(versions).toHaveLength(2);
    expect(versions[0].iv).not.toBe(versions[1].iv);
    expect(versions[0].encryptedValue).not.toBe(versions[1].encryptedValue);
  });

  // ── Read path ────────────────────────────────────────────────────────────

  it('READ can list secrets (masked — no values)', async () => {
    const res = await request(app.getHttpServer())
      .get(`/projects/${projectId}/envs/dev/secrets`)
      .set('Authorization', `Bearer ${readToken}`);
    expect(res.status).toBe(200);
    expect(res.body.secrets.length).toBeGreaterThanOrEqual(2);
    const raw = JSON.stringify(res.body);
    expect(raw).not.toContain(SECRET_VALUE_V1);
    expect(raw).not.toContain(SECRET_VALUE_V2);
    expect(raw).not.toContain('postgres://');
    // Keys and metadata ARE present.
    expect(raw).toContain('STRIPE_KEY');
    expect(raw).toContain('DATABASE_URL');
  });

  it('READ can reveal a secret', async () => {
    const res = await request(app.getHttpServer())
      .get(`/projects/${projectId}/envs/dev/secrets/STRIPE_KEY`)
      .set('Authorization', `Bearer ${readToken}`);
    expect(res.status).toBe(200);
    expect(res.body.value).toBe(SECRET_VALUE_V2);
    expect(res.body.version).toBe(2);
  });

  it('outsider (org member, no project access) gets 403 on everything', async () => {
    for (const path of [
      `/projects/${projectId}/envs/dev/secrets`,
      `/projects/${projectId}/envs/dev/secrets/STRIPE_KEY`,
      `/projects/${projectId}/envs/dev/secrets/export`,
    ]) {
      const res = await request(app.getHttpServer())
        .get(path)
        .set('Authorization', `Bearer ${outsiderToken}`);
      expect(res.status).toBe(403);
    }
  });

  it('unauthenticated requests get 401', async () => {
    const res = await request(app.getHttpServer()).get(
      `/projects/${projectId}/envs/dev/secrets`,
    );
    expect(res.status).toBe(401);
  });

  // ── Versioning & rollback ─────────────────────────────────────────────────

  it('lists version history (metadata only)', async () => {
    const res = await request(app.getHttpServer())
      .get(`/projects/${projectId}/envs/dev/secrets/STRIPE_KEY/versions`)
      .set('Authorization', `Bearer ${readToken}`);
    expect(res.status).toBe(200);
    expect(res.body.currentVersion).toBe(2);
    expect(res.body.versions).toHaveLength(2);
    expect(res.body.versions[0].version).toBe(2);
    // No ciphertext in the response.
    const raw = JSON.stringify(res.body);
    expect(raw).not.toContain('encryptedValue');
  });

  it('ADMIN can roll back to version 1', async () => {
    const res = await request(app.getHttpServer())
      .post(`/projects/${projectId}/envs/dev/secrets/STRIPE_KEY/versions/1/rollback`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body.version).toBe(3);
    expect(res.body.rolledBackTo).toBe(1);

    // The revealed value is now the v1 value again.
    const reveal = await request(app.getHttpServer())
      .get(`/projects/${projectId}/envs/dev/secrets/STRIPE_KEY`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(reveal.body.value).toBe(SECRET_VALUE_V1);
  });

  it('WRITE cannot roll back', async () => {
    const res = await request(app.getHttpServer())
      .post(`/projects/${projectId}/envs/dev/secrets/STRIPE_KEY/versions/1/rollback`)
      .set('Authorization', `Bearer ${writeToken}`);
    expect(res.status).toBe(403);
  });

  it('rejects rollback to the current version', async () => {
    const res = await request(app.getHttpServer())
      .post(`/projects/${projectId}/envs/dev/secrets/STRIPE_KEY/versions/3/rollback`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(400);
  });

  it('rejects rollback to a nonexistent version', async () => {
    const res = await request(app.getHttpServer())
      .post(`/projects/${projectId}/envs/dev/secrets/STRIPE_KEY/versions/99/rollback`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(404);
  });

  // ── Bulk import / export ─────────────────────────────────────────────────

  it('WRITE can bulk import .env content', async () => {
    const res = await request(app.getHttpServer())
      .post(`/projects/${projectId}/envs/staging/secrets/import`)
      .set('Authorization', `Bearer ${writeToken}`)
      .send({ content: 'REDIS_URL=redis://localhost:6379\nJWT_SECRET=hs256\n# comment\n' });
    expect(res.status).toBe(201);
    expect(res.body.imported).toBe(2);
    expect(res.body.created).toBe(2);
    expect(res.body.keys).toEqual(['JWT_SECRET', 'REDIS_URL']);
  });

  it('re-import updates instead of duplicating', async () => {
    const res = await request(app.getHttpServer())
      .post(`/projects/${projectId}/envs/staging/secrets/import`)
      .set('Authorization', `Bearer ${writeToken}`)
      .send({ content: 'REDIS_URL=redis://newhost:6379' });
    expect(res.status).toBe(201);
    expect(res.body.updated).toBe(1);
    expect(res.body.created).toBe(0);
  });

  it('READ cannot import', async () => {
    const res = await request(app.getHttpServer())
      .post(`/projects/${projectId}/envs/staging/secrets/import`)
      .set('Authorization', `Bearer ${readToken}`)
      .send({ content: 'A=1' });
    expect(res.status).toBe(403);
  });

  it('rejects garbage import content', async () => {
    const res = await request(app.getHttpServer())
      .post(`/projects/${projectId}/envs/staging/secrets/import`)
      .set('Authorization', `Bearer ${writeToken}`)
      .send({ content: 'this is not an env file' });
    expect(res.status).toBe(400);
  });

  it('exports all secrets as values map (audited)', async () => {
    const res = await request(app.getHttpServer())
      .get(`/projects/${projectId}/envs/staging/secrets/export`)
      .set('Authorization', `Bearer ${readToken}`);
    expect(res.status).toBe(200);
    expect(res.body.values).toEqual({
      REDIS_URL: 'redis://newhost:6379',
      JWT_SECRET: 'hs256',
    });
  });

  it('export of an empty environment 404s', async () => {
    const res = await request(app.getHttpServer())
      .get(`/projects/${projectId}/envs/prod/secrets/export`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(404);
  });

  // ── Delete ────────────────────────────────────────────────────────────────

  it('WRITE cannot delete; ADMIN can', async () => {
    const denied = await request(app.getHttpServer())
      .delete(`/projects/${projectId}/envs/dev/secrets/DATABASE_URL`)
      .set('Authorization', `Bearer ${writeToken}`);
    expect(denied.status).toBe(403);

    const ok = await request(app.getHttpServer())
      .delete(`/projects/${projectId}/envs/dev/secrets/DATABASE_URL`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(ok.status).toBe(204);
  });

  it('deleted secret is gone (404 on reveal)', async () => {
    const res = await request(app.getHttpServer())
      .get(`/projects/${projectId}/envs/dev/secrets/DATABASE_URL`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(404);
  });

  // ── Audit trail ───────────────────────────────────────────────────────────

  it('audits reveals, updates, imports, exports, rollbacks, and deletes', async () => {
    const res = await request(app.getHttpServer())
      .get(`/audit?project=${projectId}&limit=200`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    const actions = res.body.map((e: { action: string }) => e.action);
    expect(actions).toContain('SECRET_CREATED');
    expect(actions).toContain('SECRET_UPDATED');
    expect(actions).toContain('SECRET_REVEALED');
    expect(actions).toContain('SECRET_READ');
    expect(actions).toContain('SECRET_VERSION_ROLLED_BACK');
    expect(actions).toContain('SECRET_DELETED');
  });

  it('never stores secret values in the audit log', async () => {
    const logs = await prisma.auditLog.findMany({ where: { projectId } });
    const raw = JSON.stringify(logs);
    expect(raw).not.toContain(SECRET_VALUE_V1);
    expect(raw).not.toContain(SECRET_VALUE_V2);
    expect(raw).not.toContain('redis://newhost');
  });
});
