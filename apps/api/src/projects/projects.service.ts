import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { EnvelopeEncryptionService } from '../crypto/envelope-encryption.service';
import { AuditService } from '../audit/audit.service';
import { OrgsService } from '../orgs/orgs.service';
import { slugify } from '../orgs/orgs.service';
import { isValidEnvName } from '../secrets/env-format';
import { CreateProjectDto, AddProjectMemberDto } from './dto';
import { ProjectRole } from './project-role.decorator';

/** Default environments created with every project (per the plan). */
const DEFAULT_ENVS = ['dev', 'staging', 'prod'];

@Injectable()
export class ProjectsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: EnvelopeEncryptionService,
    private readonly audit: AuditService,
    private readonly orgs: OrgsService,
  ) {}

  /**
   * Create a project:
   *  1. Verify the caller is an org member.
   *  2. Generate a fresh per-project data key, wrapped by the master key.
   *  3. Create dev/staging/prod environments.
   *  4. Add the creator as project ADMIN.
   */
  async create(userId: string, orgId: string, dto: CreateProjectDto, ip?: string) {
    await this.orgs.requireMembership(orgId, userId);

    const base = slugify(dto.name) || 'project';
    let slug = base;
    let n = 1;
    while (await this.prisma.project.findUnique({ where: { orgId_slug: { orgId, slug } } })) {
      slug = `${base}-${++n}`;
    }

    const wrappedDataKey = this.crypto.generateWrappedDataKey();

    const project = await this.prisma.project.create({
      data: {
        orgId,
        name: dto.name,
        slug,
        wrappedDataKey,
        environments: {
          create: DEFAULT_ENVS.map((name) => ({ name })),
        },
        members: {
          create: { userId, role: dto.creatorRole ?? 'ADMIN' },
        },
      },
      include: {
        environments: { select: { id: true, name: true } },
        members: { include: { user: { select: { id: true, email: true, name: true } } } },
      },
    });

    await this.audit.record({
      action: 'PROJECT_CREATED',
      userId,
      orgId,
      projectId: project.id,
      resource: `project/${project.id}`,
      ip,
      meta: { name: project.name, slug: project.slug, envs: DEFAULT_ENVS },
    });

    // Never expose the wrapped data key in API responses.
    const { wrappedDataKey: _wdk, ...safe } = project;
    return safe;
  }

  /** Projects visible to the user: their orgs' projects they are members of. */
  async listForUser(userId: string) {
    const memberships = await this.prisma.projectMember.findMany({
      where: { userId },
      select: { projectId: true, role: true },
    });
    if (memberships.length === 0) return [];

    return this.prisma.project.findMany({
      where: { id: { in: memberships.map((m) => m.projectId) } },
      include: {
        org: { select: { id: true, name: true, slug: true } },
        environments: { select: { id: true, name: true } },
        _count: { select: { members: true } },
      },
      orderBy: { createdAt: 'asc' },
    });
  }

  async get(projectId: string, userId: string) {
    const member = await this.prisma.projectMember.findUnique({
      where: { projectId_userId: { projectId, userId } },
    });
    if (!member) throw new ForbiddenException('You do not have access to this project');

    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      include: {
        org: { select: { id: true, name: true, slug: true } },
        environments: { select: { id: true, name: true } },
        members: {
          include: { user: { select: { id: true, email: true, name: true } } },
          orderBy: { addedAt: 'asc' },
        },
      },
    });
    if (!project) throw new NotFoundException('Project not found');

    const { wrappedDataKey: _wdk, ...safe } = project;
    return { ...safe, yourRole: member.role };
  }

  /**
   * Dashboard stats in two queries (no N+1): secret counts per environment
   * via a relation count, plus the number of active (unrevoked, unexpired)
   * service tokens. Powers the web Overview page.
   */
  async stats(projectId: string) {
    const [envs, activeTokens] = await this.prisma.$transaction([
      this.prisma.environment.findMany({
        where: { projectId },
        select: { name: true, _count: { select: { secrets: true } } },
        orderBy: { name: 'asc' },
      }),
      this.prisma.serviceToken.count({
        where: { environment: { projectId }, revokedAt: null, expiresAt: { gt: new Date() } },
      }),
    ]);

    return {
      environments: envs.map((e) => ({ name: e.name, secrets: e._count.secrets })),
      activeTokens,
    };
  }

  /** Rename a project (ADMIN — enforced by the guard). */
  async update(projectId: string, userId: string, name: string, ip?: string) {
    const project = await this.prisma.project.findUnique({ where: { id: projectId } });
    if (!project) throw new NotFoundException('Project not found');

    const updated = await this.prisma.project.update({
      where: { id: projectId },
      data: { name },
    });

    await this.audit.record({
      action: 'PROJECT_UPDATED',
      userId,
      orgId: project.orgId,
      projectId,
      resource: `project/${projectId}`,
      ip,
      meta: { field: 'name', from: project.name, to: name },
    });

    const { wrappedDataKey: _wdk, ...safe } = updated;
    return safe;
  }

  /** Add a custom environment (e.g. "qa") to a project (ADMIN). */
  async addEnvironment(projectId: string, userId: string, name: string, ip?: string) {
    const envName = name.trim().toLowerCase();
    if (!isValidEnvName(envName)) {
      throw new BadRequestException(
        `Invalid environment name "${name.slice(0, 40)}": lowercase letters, digits, and dashes only`,
      );
    }
    const project = await this.prisma.project.findUnique({ where: { id: projectId } });
    if (!project) throw new NotFoundException('Project not found');

    const existing = await this.prisma.environment.findUnique({
      where: { projectId_name: { projectId, name: envName } },
    });
    if (existing) throw new ConflictException(`Environment "${envName}" already exists`);

    const env = await this.prisma.environment.create({
      data: { projectId, name: envName },
      select: { id: true, name: true },
    });

    await this.audit.record({
      action: 'PROJECT_UPDATED',
      userId,
      orgId: project.orgId,
      projectId,
      resource: `project/${projectId}/env/${envName}`,
      ip,
      meta: { addedEnv: envName },
    });

    return env;
  }

  /**
   * Delete a project and everything under it (envs, secrets, versions,
   * members, service tokens — all cascade). Audit entries survive because
   * AuditLog.projectId is intentionally not a FK.
   */
  async remove(projectId: string, userId: string, ip?: string) {
    const project = await this.prisma.project.findUnique({ where: { id: projectId } });
    if (!project) throw new NotFoundException('Project not found');

    await this.prisma.project.delete({ where: { id: projectId } });

    await this.audit.record({
      action: 'PROJECT_DELETED',
      userId,
      orgId: project.orgId,
      projectId,
      resource: `project/${projectId}`,
      ip,
      meta: { name: project.name, slug: project.slug },
    });
  }

  /** Add a member. Only project ADMINs may do this, and the target must be in the org. */
  async addMember(
    projectId: string,
    actorId: string,
    actorRole: ProjectRole,
    dto: AddProjectMemberDto,
    ip?: string,
  ) {
    if (actorRole !== 'ADMIN') {
      throw new ForbiddenException('Only project admins can manage members');
    }

    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      select: { orgId: true },
    });
    if (!project) throw new NotFoundException('Project not found');

    // Resolve the target: userId directly, or by email (friendly sharing).
    let targetUserId = dto.userId;
    if (!targetUserId && dto.email) {
      const targetUser = await this.prisma.user.findUnique({
        where: { email: dto.email.toLowerCase() },
        select: { id: true },
      });
      if (!targetUser) {
        throw new NotFoundException(
          `No user with email ${dto.email}. They must sign up and join the org first.`,
        );
      }
      targetUserId = targetUser.id;
    }
    if (!targetUserId) {
      throw new BadRequestException('Provide either userId or email');
    }

    // Target must already be an org member — no cross-org sharing.
    const inOrg = await this.prisma.orgMember.findUnique({
      where: { orgId_userId: { orgId: project.orgId, userId: targetUserId } },
    });
    if (!inOrg) {
      throw new BadRequestException('User must be a member of the organization first');
    }

    const existing = await this.prisma.projectMember.findUnique({
      where: { projectId_userId: { projectId, userId: targetUserId } },
    });
    if (existing) throw new ConflictException('User is already a member of this project');

    const member = await this.prisma.projectMember.create({
      data: { projectId, userId: targetUserId, role: dto.role },
      include: { user: { select: { id: true, email: true, name: true } } },
    });

    await this.audit.record({
      action: 'PROJECT_MEMBER_ADDED',
      userId: actorId,
      projectId,
      resource: `project/${projectId}/member/${targetUserId}`,
      ip,
      meta: { role: dto.role },
    });

    return member;
  }

  /**
   * Org members eligible for sharing (for the share dialog's user picker).
   * Excludes users already in the project.
   */
  async shareableOrgMembers(projectId: string, userId: string) {
    const member = await this.prisma.projectMember.findUnique({
      where: { projectId_userId: { projectId, userId } },
    });
    if (!member) throw new ForbiddenException('You do not have access to this project');

    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      select: { orgId: true },
    });
    if (!project) throw new NotFoundException('Project not found');

    const existing = await this.prisma.projectMember.findMany({
      where: { projectId },
      select: { userId: true },
    });
    const existingIds = existing.map((m) => m.userId);

    return this.prisma.orgMember.findMany({
      where: { orgId: project.orgId, userId: { notIn: existingIds } },
      include: { user: { select: { id: true, email: true, name: true } } },
      orderBy: { joinedAt: 'asc' },
    });
  }

  async updateMemberRole(
    projectId: string,
    actorId: string,
    actorRole: ProjectRole,
    targetUserId: string,
    role: ProjectRole,
    ip?: string,
  ) {
    if (actorRole !== 'ADMIN') {
      throw new ForbiddenException('Only project admins can manage members');
    }
    const target = await this.prisma.projectMember.findUnique({
      where: { projectId_userId: { projectId, userId: targetUserId } },
    });
    if (!target) throw new NotFoundException('Member not found');

    const updated = await this.prisma.projectMember.update({
      where: { id: target.id },
      data: { role },
      include: { user: { select: { id: true, email: true, name: true } } },
    });

    await this.audit.record({
      action: 'PROJECT_MEMBER_ROLE_CHANGED',
      userId: actorId,
      projectId,
      resource: `project/${projectId}/member/${targetUserId}`,
      ip,
      meta: { newRole: role },
    });

    return updated;
  }

  async removeMember(
    projectId: string,
    actorId: string,
    actorRole: ProjectRole,
    targetUserId: string,
    ip?: string,
  ) {
    if (actorId !== targetUserId && actorRole !== 'ADMIN') {
      throw new ForbiddenException('Only project admins can remove other members');
    }

    const target = await this.prisma.projectMember.findUnique({
      where: { projectId_userId: { projectId, userId: targetUserId } },
    });
    if (!target) throw new NotFoundException('Member not found');

    // Safety: never let a project end up with zero admins.
    if (target.role === 'ADMIN') {
      const admins = await this.prisma.projectMember.count({
        where: { projectId, role: 'ADMIN' },
      });
      if (admins <= 1) {
        throw new BadRequestException('Cannot remove the last admin of the project');
      }
    }

    await this.prisma.projectMember.delete({ where: { id: target.id } });

    await this.audit.record({
      action: 'PROJECT_MEMBER_REMOVED',
      userId: actorId,
      projectId,
      resource: `project/${projectId}/member/${targetUserId}`,
      ip,
    });
  }
}
