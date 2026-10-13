import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { ProjectRole } from './project-role.decorator';

/**
 * Extracts the caller's project role, attached to the request by ProjectRoleGuard.
 * Use only on routes guarded by ProjectRoleGuard.
 */
export const ProjectRoleParam = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): ProjectRole => {
    return ctx.switchToHttp().getRequest().projectRole;
  },
);
