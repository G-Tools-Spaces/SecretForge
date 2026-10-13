import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomBytes } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { CreateOrgDto, InviteMemberDto, UpdateMemberRoleDto, UpdateOrgDto } from './dto';

/** slugify("Acme Dev Team!") → "acme-dev-team" */
export function slugify(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

@Injectable()
export class OrgsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /** Create an org; the creator becomes its OWNER. */
  async create(userId: string, dto: CreateOrgDto, ip?: string) {
    const base = slugify(dto.name) || 'org';
    let slug = base;
    let n = 1;
    // Slug collisions get a numeric suffix.
    while (await this.prisma.organization.findUnique({ where: { slug } })) {
      slug = `${base}-${++n}`;
    }

    const org = await this.prisma.organization.create({
      data: {
        name: dto.name,
        slug,
        members: {
          create: { userId, role: 'OWNER' },
        },
      },
      include: { members: { include: { user: { select: { id: true, email: true, name: true } } } } },
    });

    await this.audit.record({
      action: 'ORG_CREATED',
      userId,
      orgId: org.id,
      resource: `org/${org.id}`,
      ip,
      meta: { orgName: org.name, slug: org.slug },
    });

    return org;
  }

  /** Rename an org (OWNER/ADMIN). */
  async update(orgId: string, userId: string, dto: UpdateOrgDto, ip?: string) {
    await this.requireAdmin(orgId, userId);
    const org = await this.prisma.organization.findUnique({ where: { id: orgId } });
    if (!org) throw new NotFoundException('Organization not found');

    const updated = await this.prisma.organization.update({
      where: { id: orgId },
      data: { name: dto.name },
    });

    await this.audit.record({
      action: 'ORG_UPDATED',
      userId,
      orgId,
      resource: `org/${orgId}`,
      ip,
      meta: { field: 'name', from: org.name, to: dto.name },
    });

    return updated;
  }

  /** Orgs the user belongs to. */
  async listForUser(userId: string) {
    return this.prisma.organization.findMany({
      where: { members: { some: { userId } } },
      include: {
        members: { select: { userId: true, role: true } },
        _count: { select: { projects: true } },
      },
      orderBy: { createdAt: 'asc' },
    });
  }

  /** Assert membership and return the member row; throws 403 otherwise. */
  async requireMembership(orgId: string, userId: string) {
    const member = await this.prisma.orgMember.findUnique({
      where: { orgId_userId: { orgId, userId } },
    });
    if (!member) {
      throw new ForbiddenException('You are not a member of this organization');
    }
    return member;
  }

  /** Require ADMIN or OWNER. */
  async requireAdmin(orgId: string, userId: string) {
    const member = await this.requireMembership(orgId, userId);
    if (member.role !== 'OWNER' && member.role !== 'ADMIN') {
      throw new ForbiddenException('Org admin role required');
    }
    return member;
  }

  async get(orgId: string, userId: string) {
    await this.requireMembership(orgId, userId);
    const org = await this.prisma.organization.findUnique({
      where: { id: orgId },
      include: {
        members: {
          include: { user: { select: { id: true, email: true, name: true } } },
          orderBy: { joinedAt: 'asc' },
        },
        projects: { select: { id: true, name: true, slug: true, createdAt: true } },
      },
    });
    if (!org) throw new NotFoundException('Organization not found');
    return org;
  }

  /** Invite by email. Creates a single-use token valid for 7 days. */
  async invite(orgId: string, inviterId: string, dto: InviteMemberDto, ip?: string) {
    await this.requireAdmin(orgId, inviterId);
    const email = dto.email.toLowerCase();

    const existingUser = await this.prisma.user.findUnique({ where: { email } });
    if (existingUser) {
      const alreadyMember = await this.prisma.orgMember.findUnique({
        where: { orgId_userId: { orgId, userId: existingUser.id } },
      });
      if (alreadyMember) {
        throw new ConflictException('This user is already a member of the organization');
      }
    }

    const existingInvite = await this.prisma.orgInvite.findUnique({
      where: { orgId_email: { orgId, email } },
    });
    if (existingInvite && existingInvite.expiresAt > new Date() && !existingInvite.acceptedAt) {
      throw new ConflictException('An invite for this email is already pending');
    }

    // Replace stale invite if any.
    if (existingInvite) {
      await this.prisma.orgInvite.delete({ where: { id: existingInvite.id } });
    }

    const invite = await this.prisma.orgInvite.create({
      data: {
        orgId,
        email,
        role: dto.role ?? 'MEMBER',
        token: randomBytes(24).toString('base64url'),
        invitedById: inviterId,
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      },
    });

    await this.audit.record({
      action: 'ORG_INVITE_CREATED',
      userId: inviterId,
      orgId,
      resource: `org/${orgId}/invite/${email}`,
      ip,
      meta: { email, role: dto.role ?? 'MEMBER' },
    });

    // Phase 5: send the invite email via a mailer. For now the token is
    // returned so the team can share it manually (self-hosted MVP).
    return { id: invite.id, email, role: invite.role, expiresAt: invite.expiresAt, token: invite.token };
  }

  /** Accept an invite with the token (must be logged in as the invited email). */
  async acceptInvite(userId: string, email: string, token: string, ip?: string) {
    const invite = await this.prisma.orgInvite.findUnique({ where: { token } });
    if (!invite || invite.acceptedAt || invite.expiresAt < new Date()) {
      throw new BadRequestException('This invite is invalid or has expired');
    }
    if (invite.email !== email.toLowerCase()) {
      throw new ForbiddenException('This invite was issued for a different email address');
    }

    await this.prisma.$transaction([
      this.prisma.orgMember.create({
        data: { orgId: invite.orgId, userId, role: invite.role },
      }),
      this.prisma.orgInvite.update({
        where: { id: invite.id },
        data: { acceptedAt: new Date() },
      }),
    ]);

    await this.audit.record({
      action: 'ORG_MEMBER_JOINED',
      userId,
      orgId: invite.orgId,
      resource: `org/${invite.orgId}/member/${email}`,
      ip,
    });

    return { orgId: invite.orgId };
  }

  async listInvites(orgId: string, userId: string) {
    await this.requireAdmin(orgId, userId);
    return this.prisma.orgInvite.findMany({
      where: { orgId, acceptedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { createdAt: 'desc' },
    });
  }

  async revokeInvite(orgId: string, userId: string, inviteId: string, ip?: string) {
    await this.requireAdmin(orgId, userId);
    const invite = await this.prisma.orgInvite.findFirst({ where: { id: inviteId, orgId } });
    if (!invite) throw new NotFoundException('Invite not found');
    await this.prisma.orgInvite.delete({ where: { id: invite.id } });
    await this.audit.record({
      action: 'ORG_INVITE_REVOKED',
      userId,
      orgId,
      resource: `org/${orgId}/invite/${invite.email}`,
      ip,
    });
  }

  async updateMemberRole(orgId: string, actorId: string, targetUserId: string, role: UpdateMemberRoleDto['role'], ip?: string) {
    const actor = await this.requireAdmin(orgId, actorId);

    const target = await this.prisma.orgMember.findUnique({
      where: { orgId_userId: { orgId, userId: targetUserId } },
    });
    if (!target) throw new NotFoundException('Member not found');

    // Only OWNERs may grant/revoke OWNER.
    if (role === 'OWNER' && actor.role !== 'OWNER') {
      throw new ForbiddenException('Only an owner can assign the owner role');
    }
    if (target.role === 'OWNER' && role !== 'OWNER') {
      const owners = await this.prisma.orgMember.count({ where: { orgId, role: 'OWNER' } });
      if (owners <= 1) {
        throw new BadRequestException('Cannot demote the last owner of the organization');
      }
    }

    const updated = await this.prisma.orgMember.update({
      where: { id: target.id },
      data: { role },
      include: { user: { select: { id: true, email: true, name: true } } },
    });

    await this.audit.record({
      action: 'ORG_MEMBER_ROLE_CHANGED',
      userId: actorId,
      orgId,
      resource: `org/${orgId}/member/${targetUserId}`,
      ip,
      meta: { newRole: role },
    });

    return updated;
  }

  async removeMember(orgId: string, actorId: string, targetUserId: string, ip?: string) {
    const actor = await this.requireAdmin(orgId, actorId);

    const target = await this.prisma.orgMember.findUnique({
      where: { orgId_userId: { orgId, userId: targetUserId } },
    });
    if (!target) throw new NotFoundException('Member not found');

    if (target.role === 'OWNER') {
      const owners = await this.prisma.orgMember.count({ where: { orgId, role: 'OWNER' } });
      if (owners <= 1) {
        throw new BadRequestException('Cannot remove the last owner of the organization');
      }
      if (actor.role !== 'OWNER') {
        throw new ForbiddenException('Only an owner can remove another owner');
      }
    }

    await this.prisma.orgMember.delete({ where: { id: target.id } });

    await this.audit.record({
      action: 'ORG_MEMBER_REMOVED',
      userId: actorId,
      orgId,
      resource: `org/${orgId}/member/${targetUserId}`,
      ip,
    });
  }
}
