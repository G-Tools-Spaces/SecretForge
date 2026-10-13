import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PrismaService } from '../prisma/prisma.service';
import { MIN_PROJECT_ROLE_KEY, ROLE_RANK, ProjectRole } from './project-role.decorator';

/**
 * Enforces project membership + minimum role on every request (plan security
 * req #5: "Check role on every request").
 *
 * Expects the project id in the `projectId` route param. Attaches the caller's
 * ProjectRole to `request.projectRole` for controllers that need finer logic.
 */
@Injectable()
export class ProjectRoleGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();

    const requiredRole = this.reflector.getAllAndOverride<ProjectRole>(MIN_PROJECT_ROLE_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!requiredRole) return true; // no role requirement declared

    const projectId = request.params.projectId;
    const userId = request.user?.id;
    if (!projectId || !userId) {
      throw new ForbiddenException('Missing project or user context');
    }

    const member = await this.prisma.projectMember.findUnique({
      where: { projectId_userId: { projectId, userId } },
    });

    if (!member) {
      // Non-members get a plain 403 — don't leak whether the project exists.
      throw new ForbiddenException('You do not have access to this project');
    }

    if (ROLE_RANK[member.role] < ROLE_RANK[requiredRole]) {
      throw new ForbiddenException(`This action requires the ${requiredRole} role`);
    }

    request.projectRole = member.role;
    return true;
  }
}
