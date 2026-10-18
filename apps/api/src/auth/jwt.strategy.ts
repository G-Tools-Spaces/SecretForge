import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { Request } from 'express';
import { EnvService } from '../config/env.service';
import { JwtPayload } from './jwt-payload';
import { ACCESS_COOKIE, readCookie } from './cookies';

/**
 * Validates the JWT signature and that the user still exists.
 * (Session/refresh revocation is enforced separately on /auth/refresh —
 * access tokens are short-lived by design.)
 *
 * Token sources, in order:
 *  1. Authorization: Bearer … — CLI, SDKs, service integrations.
 *  2. sf_access httpOnly cookie — the web app (XSS can never read it).
 */
@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(env: EnvService) {
    super({
      jwtFromRequest: ExtractJwt.fromExtractors([
        ExtractJwt.fromAuthHeaderAsBearerToken(),
        (req: Request) => (req ? readCookie(req, ACCESS_COOKIE) ?? null : null),
      ]),
      ignoreExpiration: false,
      secretOrKey: env.jwtSecret,
    });
  }

  validate(payload: JwtPayload) {
    if (!payload?.sub) {
      throw new UnauthorizedException();
    }
    return { id: payload.sub, email: payload.email };
  }
}
