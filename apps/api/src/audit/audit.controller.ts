import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { AuthedUser } from '../auth/jwt-payload';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from './audit.service';

@Controller('audit')
@UseGuards(JwtAuthGuard)
export class AuditController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /**
   * GET /audit?project=<id>&action=<name>&limit=<n>
   * Users see only entries for orgs/projects they belong to (enforced below).
   */
  @Get()
  async list(
    @CurrentUser() user: AuthedUser,
    @Query('project') projectId?: string,
    @Query('action') action?: string,
    @Query('limit') limit?: string,
  ) {
    // Which orgs does this user belong to?
    const memberships = await this.prisma.orgMember.findMany({
      where: { userId: user.id },
      select: { orgId: true },
    });
    const orgIds = memberships.map((m) => m.orgId);
    if (orgIds.length === 0) return [];

    // If a project filter is given, verify the user has access to that project.
    let projectFilter: { projectId?: string } = {};
    if (projectId) {
      const project = await this.prisma.project.findUnique({
        where: { id: projectId },
        select: { id: true, orgId: true },
      });
      const hasOrgAccess = project && orgIds.includes(project.orgId);
      const isProjectMember = await this.prisma.projectMember.findUnique({
        where: { projectId_userId: { projectId, userId: user.id } },
      });
      if (!hasOrgAccess && !isProjectMember) return [];
      projectFilter = { projectId };
    }

    const take = Math.min(Math.max(parseInt(limit ?? '50', 10) || 50, 1), 200);

    return this.prisma.auditLog.findMany({
      where: {
        ...projectFilter,
        ...(action ? { action } : {}),
        OR: [{ orgId: { in: orgIds } }, { projectId: projectFilter.projectId }],
      },
      orderBy: { createdAt: 'desc' },
      take,
      include: {
        user: { select: { id: true, email: true, name: true } },
      },
    });
  }
}
