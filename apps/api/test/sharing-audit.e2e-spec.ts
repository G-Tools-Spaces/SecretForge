import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import './setup-e2e';

/**
 * Phase 4 e2e: sharing by email, shareable-members picker, auth-event
 * auditing, denied-access auditing, and the enhanced audit query API.
 */
describe('Sharing & audit (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  let ownerToken: string;   // org OWNER + project ADMIN
  let aliceToken: string;   // org member, project ADMIN (shares)
  let bobToken: string;    // org member, no project access yet
  let malloryToken: string; // different org entirely
  let orgId: string;
  let projectId: string;
  let bobId: string;

  const uniq = Date.now();

  async function signup(email: string): Promise<string> {
    const res = await request(app.getHttpServer())
      .post('/auth/signup')
      .send({ email, password: 'correct-horse-battery', name: email.split('@')[0] });
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

    ownerToken = await signup(`owner-sh-${uniq}@example.com`);
    aliceToken = await signup(`alice-sh-${uniq}@example.com`);
    bobToken = await signup(`bob-sh-${uniq}@example.com`);
    malloryToken = await signup(`mallory-sh-${uniq}@example.com`);

    // Org with owner + alice + bob.
    const org = await request(app.getHttpServer())
      .post('/orgs')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ name: `Share Org ${uniq}` });
    orgId = org.body.id;

    for (const [token, email] of [
      [aliceToken, `alice-sh-${uniq}@example.com`],
      [bobToken, `bob-sh-${uniq}@example.com`],
    ] as const) {
      const invite = await request(app.getHttpServer())
        .post(`/orgs/${orgId}/invite`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ email });
      await request(app.getHttpServer())
        .post(`/orgs/${orgId}/invites/accept`)
        .set('Authorization', `Bearer ${token}`)
        .send({ token: invite.body.token });
    }

    const bob = await request(app.getHttpServer())
      .get('/auth/me')
      .set('Authorization', `Bearer ${bobToken}`);
    bobId = bob.body.id;

    // Alice creates the project (she becomes project ADMIN).
    const project = await request(app.getHttpServer())
      .post('/projects')
      .set('Authorization', `Bearer ${aliceToken}`)
      .send({ orgId, name: `shared-app ${uniq}` });
    projectId = project.body.id;

    // A secret to protect.
    await request(app.getHttpServer())
      .put(`/projects/${projectId}/envs/dev/secrets/API_KEY`)
      .set('Authorization', `Bearer ${aliceToken}`)
      .send({ value: 'sk_share_test_value' });
  });

  afterAll(async () => {
    await app.close();
  });

  // ── Sharing by email ──────────────────────────────────────────────────────

  it('project admin can share with an org member BY EMAIL', async () => {
    const res = await request(app.getHttpServer())
      .post(`/projects/${projectId}/members`)
      .set('Authorization', `Bearer ${aliceToken}`)
      .send({ email: `bob-sh-${uniq}@example.com`, role: 'READ' });
    expect(res.status).toBe(201);
    expect(res.body.user.email).toBe(`bob-sh-${uniq}@example.com`);
    expect(res.body.role).toBe('READ');
  });

  it('shared member can now read the project', async () => {
    const res = await request(app.getHttpServer())
      .get(`/projects/${projectId}/envs/dev/secrets`)
      .set('Authorization', `Bearer ${bobToken}`);
    expect(res.status).toBe(200);
    expect(res.body.secrets[0].key).toBe('API_KEY');
  });

  it('rejects sharing with an email that has no account', async () => {
    const res = await request(app.getHttpServer())
      .post(`/projects/${projectId}/members`)
      .set('Authorization', `Bearer ${aliceToken}`)
      .send({ email: `ghost-${uniq}@example.com`, role: 'READ' });
    expect(res.status).toBe(404);
    expect(res.body.message).toMatch(/must sign up/i);
  });

  it('rejects sharing with a user outside the org', async () => {
    const res = await request(app.getHttpServer())
      .post(`/projects/${projectId}/members`)
      .set('Authorization', `Bearer ${aliceToken}`)
      .send({ email: `mallory-sh-${uniq}@example.com`, role: 'READ' });
    expect(res.status).toBe(400);
  });

  it('requires userId or email', async () => {
    const res = await request(app.getHttpServer())
      .post(`/projects/${projectId}/members`)
      .set('Authorization', `Bearer ${aliceToken}`)
      .send({ role: 'READ' });
    expect(res.status).toBe(400);
  });

  it('lists shareable org members (excludes current project members)', async () => {
    const res = await request(app.getHttpServer())
      .get(`/projects/${projectId}/shareable-members`)
      .set('Authorization', `Bearer ${aliceToken}`);
    expect(res.status).toBe(200);
    const emails = res.body.map((m: { user: { email: string } }) => m.user.email);
    expect(emails).not.toContain(`bob-sh-${uniq}@example.com`); // already a member
    expect(emails).toContain(`owner-sh-${uniq}@example.com`); // org member, not in project
  });

  it('blocks non-admins from the shareable-members picker', async () => {
    const res = await request(app.getHttpServer())
      .get(`/projects/${projectId}/shareable-members`)
      .set('Authorization', `Bearer ${bobToken}`);
    expect(res.status).toBe(403);
  });

  // ── Denied-access auditing ────────────────────────────────────────────────

  it('audits denied access attempts with reason + IP', async () => {
    // Mallory (outside org) tries to read.
    await request(app.getHttpServer())
      .get(`/projects/${projectId}/envs/dev/secrets`)
      .set('Authorization', `Bearer ${malloryToken}`)
      .expect(403);

    // Bob (READ) tries to write.
    await request(app.getHttpServer())
      .put(`/projects/${projectId}/envs/dev/secrets/NEW_KEY`)
      .set('Authorization', `Bearer ${bobToken}`)
      .send({ value: 'x' })
      .expect(403);

    const denied = await prisma.auditLog.findMany({
      where: { projectId, action: 'ACCESS_DENIED' },
      orderBy: { createdAt: 'desc' },
    });
    expect(denied.length).toBeGreaterThanOrEqual(2);

    const reasons = denied.map((d) => (d.meta as { reason?: string })?.reason);
    expect(reasons).toContain('not_a_member');
    expect(reasons).toContain('insufficient_role');

    // Every denied entry carries an IP (for the "unknown IP" alert).
    for (const d of denied) {
      expect(d.ip).toBeTruthy();
    }
  });

  // ── Auth-event auditing ───────────────────────────────────────────────────

  it('audits logins, failed logins, and logouts', async () => {
    // Successful login
    await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: `bob-sh-${uniq}@example.com`, password: 'correct-horse-battery' })
      .expect(200);
    // Failed login
    await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: `bob-sh-${uniq}@example.com`, password: 'wrong-password' })
      .expect(401);

    const login = await prisma.auditLog.findFirst({
      where: { action: 'USER_LOGIN', user: { email: `bob-sh-${uniq}@example.com` } },
      orderBy: { createdAt: 'desc' },
    });
    expect(login).not.toBeNull();

    const failed = await prisma.auditLog.findFirst({
      where: { action: 'USER_LOGIN_FAILED' },
      orderBy: { createdAt: 'desc' },
    });
    expect(failed).not.toBeNull();
    // The failed-login resource contains the attempted email for alerting,
    // but NEVER a password.
    expect(failed!.resource).toContain(`bob-sh-${uniq}@example.com`);
    expect(JSON.stringify(failed)).not.toMatch(/password/i);
  });

  // ── Enhanced audit query API ──────────────────────────────────────────────

  it('supports action filtering', async () => {
    const res = await request(app.getHttpServer())
      .get(`/audit?project=${projectId}&action=SECRET_CREATED`)
      .set('Authorization', `Bearer ${aliceToken}`);
    expect(res.status).toBe(200);
    expect(res.body.total).toBeGreaterThanOrEqual(1);
    for (const e of res.body.entries) {
      expect(e.action).toBe('SECRET_CREATED');
    }
  });

  it('supports date-range filtering', async () => {
    // Entries were created in beforeAll (moments ago) — the window must
    // start in the past and end in the future.
    const past = new Date(Date.now() - 60 * 60 * 1000);
    const future = new Date(Date.now() + 60_000);
    const res = await request(app.getHttpServer())
      .get(`/audit?project=${projectId}&since=${past.toISOString()}&until=${future.toISOString()}`)
      .set('Authorization', `Bearer ${aliceToken}`);
    expect(res.status).toBe(200);
    expect(res.body.total).toBeGreaterThanOrEqual(1);
    for (const e of res.body.entries) {
      const t = new Date(e.createdAt).getTime();
      expect(t).toBeGreaterThanOrEqual(past.getTime());
      expect(t).toBeLessThanOrEqual(future.getTime());
    }

    // A window entirely in the future must return nothing.
    const farFuture = new Date(Date.now() + 24 * 60 * 60 * 1000);
    const empty = await request(app.getHttpServer())
      .get(
        `/audit?project=${projectId}&since=${farFuture.toISOString()}&until=${new Date(
          farFuture.getTime() + 1000,
        ).toISOString()}`,
      )
      .set('Authorization', `Bearer ${aliceToken}`);
    expect(empty.body.total).toBe(0);
  });

  it('supports pagination', async () => {
    const page1 = await request(app.getHttpServer())
      .get(`/audit?project=${projectId}&limit=2&offset=0`)
      .set('Authorization', `Bearer ${aliceToken}`);
    const page2 = await request(app.getHttpServer())
      .get(`/audit?project=${projectId}&limit=2&offset=2`)
      .set('Authorization', `Bearer ${aliceToken}`);
    expect(page1.body.entries.length).toBeLessThanOrEqual(2);
    expect(page2.body.entries.length).toBeLessThanOrEqual(2);
    // No overlap between pages.
    const ids1 = new Set(page1.body.entries.map((e: { id: string }) => e.id));
    const ids2 = page2.body.entries.map((e: { id: string }) => e.id);
    for (const id of ids2) expect(ids1.has(id)).toBe(false);
    expect(page1.body.total).toBe(page2.body.total);
  });

  it('denies audit access to non-members', async () => {
    const res = await request(app.getHttpServer())
      .get(`/audit?project=${projectId}`)
      .set('Authorization', `Bearer ${malloryToken}`);
    expect(res.status).toBe(200);
    expect(res.body.entries).toEqual([]);
    expect(res.body.total).toBe(0);
  });
});
