import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import './setup-e2e';

/**
 * Authorization e2e (plan security req #5: check role on every request):
 *  - non-members cannot see or touch a project
 *  - READ members cannot mutate members
 *  - only org members can be added to a project
 *  - last-admin protection
 * Also verifies the wrapped data key never leaks through the API.
 */
describe('Projects & roles (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  let aliceToken: string;
  let bobToken: string;
  let carolToken: string; // same org, not a project member
  let daveToken: string; // different org entirely
  let orgId: string;
  let projectId: string;
  let bobId: string;
  let carolId: string;

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

    aliceToken = await signup(`alice-p-${uniq}@example.com`);
    bobToken = await signup(`bob-p-${uniq}@example.com`);
    carolToken = await signup(`carol-p-${uniq}@example.com`);
    daveToken = await signup(`dave-p-${uniq}@example.com`);

    // Alice creates an org and invites Bob + Carol into it.
    const org = await request(app.getHttpServer())
      .post('/orgs')
      .set('Authorization', `Bearer ${aliceToken}`)
      .send({ name: `Acme ${uniq}` });
    orgId = org.body.id;

    for (const [token, email] of [
      [bobToken, `bob-p-${uniq}@example.com`],
      [carolToken, `carol-p-${uniq}@example.com`],
    ] as const) {
      const invite = await request(app.getHttpServer())
        .post(`/orgs/${orgId}/invite`)
        .set('Authorization', `Bearer ${aliceToken}`)
        .send({ email, role: 'MEMBER' });
      expect(invite.status).toBe(201);
      const accepted = await request(app.getHttpServer())
        .post(`/orgs/${orgId}/invites/accept`)
        .set('Authorization', `Bearer ${token}`)
        .send({ token: invite.body.token });
      expect(accepted.status).toBe(200);
    }

    const bob = await request(app.getHttpServer())
      .get('/auth/me')
      .set('Authorization', `Bearer ${bobToken}`);
    bobId = bob.body.id;
    const carol = await request(app.getHttpServer())
      .get('/auth/me')
      .set('Authorization', `Bearer ${carolToken}`);
    carolId = carol.body.id;

    // Alice creates a project.
    const project = await request(app.getHttpServer())
      .post('/projects')
      .set('Authorization', `Bearer ${aliceToken}`)
      .send({ orgId, name: `payments-api ${uniq}` });
    expect(project.status).toBe(201);
    projectId = project.body.id;
  });

  afterAll(async () => {
    await app.close();
  });

  it('creates a project with dev/staging/prod environments', async () => {
    const res = await request(app.getHttpServer())
      .get(`/projects/${projectId}`)
      .set('Authorization', `Bearer ${aliceToken}`);
    expect(res.status).toBe(200);
    const envNames = res.body.environments.map((e: { name: string }) => e.name).sort();
    expect(envNames).toEqual(['dev', 'prod', 'staging']);
  });

  it('never returns the wrapped data key', async () => {
    const res = await request(app.getHttpServer())
      .get(`/projects/${projectId}`)
      .set('Authorization', `Bearer ${aliceToken}`);
    expect(res.body.wrappedDataKey).toBeUndefined();
    expect(JSON.stringify(res.body)).not.toContain('wrappedDataKey');
  });

  it('blocks non-members from reading the project', async () => {
    const res = await request(app.getHttpServer())
      .get(`/projects/${projectId}`)
      .set('Authorization', `Bearer ${carolToken}`);
    expect(res.status).toBe(403);
  });

  it('blocks users outside the org entirely', async () => {
    const res = await request(app.getHttpServer())
      .get(`/projects/${projectId}`)
      .set('Authorization', `Bearer ${daveToken}`);
    expect(res.status).toBe(403);
  });

  it('requires authentication', async () => {
    const res = await request(app.getHttpServer()).get(`/projects/${projectId}`);
    expect(res.status).toBe(401);
  });

  it('lets the project admin add an org member with a role', async () => {
    const res = await request(app.getHttpServer())
      .post(`/projects/${projectId}/members`)
      .set('Authorization', `Bearer ${aliceToken}`)
      .send({ userId: bobId, role: 'READ' });
    expect(res.status).toBe(201);
    expect(res.body.role).toBe('READ');
  });

  it('rejects adding someone who is not in the org', async () => {
    const dave = await request(app.getHttpServer())
      .get('/auth/me')
      .set('Authorization', `Bearer ${daveToken}`);
    const res = await request(app.getHttpServer())
      .post(`/projects/${projectId}/members`)
      .set('Authorization', `Bearer ${aliceToken}`)
      .send({ userId: dave.body.id, role: 'READ' });
    expect(res.status).toBe(400);
  });

  it('blocks a READ member from managing members', async () => {
    const res = await request(app.getHttpServer())
      .post(`/projects/${projectId}/members`)
      .set('Authorization', `Bearer ${bobToken}`)
      .send({ userId: carolId, role: 'READ' });
    expect(res.status).toBe(403);
  });

  it('lets a READ member view the project', async () => {
    const res = await request(app.getHttpServer())
      .get(`/projects/${projectId}`)
      .set('Authorization', `Bearer ${bobToken}`);
    expect(res.status).toBe(200);
    expect(res.body.yourRole).toBe('READ');
  });

  it('lets an admin promote a member', async () => {
    const res = await request(app.getHttpServer())
      .post(`/projects/${projectId}/members/${bobId}/role`)
      .set('Authorization', `Bearer ${aliceToken}`)
      .send({ role: 'WRITE' });
    expect(res.status).toBe(201);
    expect(res.body.role).toBe('WRITE');
  });

  it('still blocks a WRITE member from managing members', async () => {
    const res = await request(app.getHttpServer())
      .post(`/projects/${projectId}/members`)
      .set('Authorization', `Bearer ${bobToken}`)
      .send({ userId: carolId, role: 'READ' });
    expect(res.status).toBe(403);
  });

  it('prevents removing the last admin', async () => {
    const res = await request(app.getHttpServer())
      .delete(`/projects/${projectId}/members/${(await whoami(aliceToken)).id}`)
      .set('Authorization', `Bearer ${aliceToken}`);
    expect(res.status).toBe(400);
  });

  it('lets a member remove themselves', async () => {
    const res = await request(app.getHttpServer())
      .delete(`/projects/${projectId}/members/${bobId}`)
      .set('Authorization', `Bearer ${bobToken}`);
    expect(res.status).toBe(204);

    // And now Bob is locked out again.
    const after = await request(app.getHttpServer())
      .get(`/projects/${projectId}`)
      .set('Authorization', `Bearer ${bobToken}`);
    expect(after.status).toBe(403);
  });

  it('writes audit entries for project lifecycle events', async () => {
    const res = await request(app.getHttpServer())
      .get(`/audit?project=${projectId}`)
      .set('Authorization', `Bearer ${aliceToken}`);
    expect(res.status).toBe(200);
    const actions = res.body.map((e: { action: string }) => e.action);
    expect(actions).toContain('PROJECT_CREATED');
    expect(actions).toContain('PROJECT_MEMBER_ADDED');
    expect(actions).toContain('PROJECT_MEMBER_REMOVED');
  });

  it('never stores secret values in audit meta', async () => {
    const logs = await prisma.auditLog.findMany({ where: { projectId } });
    const raw = JSON.stringify(logs);
    expect(raw).not.toMatch(/"value"\s*:/i);
    expect(raw).not.toMatch(/"plaintext"\s*:/i);
  });

  async function whoami(token: string) {
    const res = await request(app.getHttpServer())
      .get('/auth/me')
      .set('Authorization', `Bearer ${token}`);
    return res.body;
  }
});
