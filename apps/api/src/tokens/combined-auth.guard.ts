import { ExecutionContext, Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { TokensService, ServiceTokenActor } from './tokens.service';

/**
 * Accepts EITHER a user JWT Bearer token OR a service token (`Bearer sf_...`).
 *
 * Service tokens are validated here (hash lookup, expiry, revocation, env
 * scope against the route's :projectId/:env params) and attached to the
 * request as `request.serviceToken`. ProjectRoleGuard then enforces their
 * read-only nature. Anything else falls through to the normal JWT strategy.
 */
@Injectable()
export class CombinedAuthGuard extends AuthGuard('jwt') {
  constructor(private readonly tokens: TokensService) {
    super();
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const auth: unknown = request.headers?.authorization;

    if (typeof auth === 'string' && auth.startsWith('Bearer sf_')) {
      const presented = auth.slice('Bearer '.length).trim();
      const actor: ServiceTokenActor = await this.tokens.validateForRequest(
        presented,
        request.params.projectId,
        request.params.env,
        request.ip,
      );
      request.serviceToken = actor;
      return true;
    }

    return (await super.canActivate(context)) as boolean;
  }
}
