import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { AuthedUser } from './jwt-payload';

/** Extracts the authenticated user attached by JwtStrategy.validate(). */
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthedUser => {
    return ctx.switchToHttp().getRequest().user;
  },
);
