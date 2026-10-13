import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { AuthedUser } from '../auth/jwt-payload';
import { PrismaService } from '../prisma/prisma.service';

@Controller('audit')
@UseGuards(JwtAuthGuard)
export class AuditController {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * GET /audit?project=<id>&action=<name>&since=<iso>&until=<iso>&limit=<n>&offset=<n>
   *
   * Users see only entries for orgs/projects they belong to (enforced below).
   * Supports the filters the wireframe's audit-log page needs.
   */
  @Get()
  async list(
    @CurrentUser() user: AuthedUser,
    @Query('project') projectId?: string,
    @Query('action') action?: string,
    @Query('since') since?: string,
    @Query('until') until?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    // Which orgs does this user belong to?
    const memberships = await this.prisma.orgMember.findMany({
      where: { userId: user.id },
      select: { orgId: true },
    });
    const orgIds = memberships.map((m) => m.orgId);
    if (orgIds.length === 0) return { entries: [], total: 0 };

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
      if (!hasOrgAccess && !isProjectMember) return { entries: [], total: 0 };
      projectFilter = { projectId };
    }

    const sinceDate = since ? new Date(since) : null;
    const untilDate = until ? new Date(until) : null;
    if ((since && isNaN(sinceDate!.getTime())) || (until && isNaN(untilDate!.getTime()))) {
      return { entries: [], total: 0, error: 'invalid date filter' };
    }

    const take = Math.min(Math.max(parseInt(limit ?? '50', 10) || 50, 1), 200);
    const skip = Math.max(parseInt(offset ?? '0', 10) || 0, 0);

    const where = {
      ...projectFilter,
      ...(action ? { action } : {}),
      ...(sinceDate || untilDate
        ? {
            createdAt: {
              ...(sinceDate ? { gte: sinceDate } : {}),
              ...(untilDate ? { lte: untilDate } : {}),
            },
          }
        : {}),
      OR: [{ orgId: { in: orgIds } }, { projectId: projectFilter.projectId }],
    };

    const [entries, total] = await this.prisma.$transaction([
      this.prisma.auditLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take,
        skip,
        include: {
          user: { select: { id: true, email: true, name: true } },
        },
      }),
      this.prisma.auditLog.count({ where }),
    ]);

    return { entries, total };
  }
}
