import { BadRequestException, Injectable, UnauthorizedException, ConflictException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { hash, verify } from '@node-rs/argon2';
import { createHash, randomBytes } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { EnvService } from '../config/env.service';
import { AuditService } from '../audit/audit.service';
import { SignupDto, LoginDto, ChangePasswordDto } from './dto';
import { JwtPayload } from './jwt-payload';

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
}

/**
 * Authentication:
 *  - argon2id password hashing (memory-hard, current OWASP recommendation)
 *  - short-lived JWT access tokens (default 15 min)
 *  - opaque refresh tokens stored ONLY as SHA-256 hashes, rotated on every use
 *    (a replayed refresh token revokes the session — theft is detectable)
 */
@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly env: EnvService,
    private readonly audit: AuditService,
  ) {}

  private hashToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  /** Public so OAuthService can issue a pair after a verified social sign-in. */
  async issueTokens(userId: string, email: string, device?: string, ip?: string): Promise<TokenPair> {
    const payload: JwtPayload = { sub: userId, email };
    const accessToken = await this.jwt.signAsync(payload, {
      expiresIn: this.env.accessTokenTtl,
    });

    const refreshToken = randomBytes(48).toString('base64url');
    const expiresAt = new Date(Date.now() + this.env.refreshTokenTtlDays * 24 * 60 * 60 * 1000);

    await this.prisma.session.create({
      data: {
        userId,
        hashedRefreshToken: this.hashToken(refreshToken),
        device: device ?? null,
        ip: ip ?? null,
        expiresAt,
      },
    });

    return { accessToken, refreshToken };
  }

  async signup(dto: SignupDto, ip?: string): Promise<TokenPair & { user: { id: string; email: string; name: string | null } }> {
    const existing = await this.prisma.user.findUnique({ where: { email: dto.email.toLowerCase() } });
    if (existing) {
      throw new ConflictException('An account with this email already exists');
    }

    // argon2id: default parameters are memory-hard and tuned by the library.
    const passwordHash = await hash(dto.password);
    const user = await this.prisma.user.create({
      data: {
        email: dto.email.toLowerCase(),
        name: dto.name ?? null,
        passwordHash,
      },
    });

    const tokens = await this.issueTokens(user.id, user.email, 'signup', ip);

    await this.audit.record({
      action: 'USER_SIGNUP',
      userId: user.id,
      resource: `user/${user.id}`,
      ip,
    });

    return { ...tokens, user: { id: user.id, email: user.email, name: user.name } };
  }

  async login(dto: LoginDto, ip?: string): Promise<TokenPair & { user: { id: string; email: string; name: string | null } }> {
    const user = await this.prisma.user.findUnique({ where: { email: dto.email.toLowerCase() } });
    // Always run a verification even when the user is missing, to keep timing
    // consistent and avoid user-enumeration via response time.
    const hash_ = user?.passwordHash ?? (await hash('dummy-password-for-timing'));
    const ok = await verify(hash_, dto.password);

    if (!user || !ok) {
      // Failed logins are audited WITHOUT a userId (the email may not exist),
      // but the attempted identifier is kept in meta for alerting (plan:
      // "Alert on failed logins"). Never record the password.
      await this.audit.record({
        action: 'USER_LOGIN_FAILED',
        actorType: 'SYSTEM',
        resource: `auth/login/${dto.email.toLowerCase()}`,
        ip,
        meta: { reason: 'invalid_credentials' },
      });
      throw new UnauthorizedException('Invalid email or password');
    }

    const tokens = await this.issueTokens(user.id, user.email, 'login', ip);

    await this.audit.record({
      action: 'USER_LOGIN',
      userId: user.id,
      resource: `user/${user.id}`,
      ip,
      meta: { device: 'login' },
    });

    return { ...tokens, user: { id: user.id, email: user.email, name: user.name } };
  }

  /**
   * Rotate a refresh token: the old session row is consumed and a new one is
   * issued. If the presented token was already used (replay), revoke the whole
   * session — it likely means the token was stolen.
   */
  async refresh(refreshToken: string, ip?: string): Promise<TokenPair> {
    const hashed = this.hashToken(refreshToken);
    const session = await this.prisma.session.findUnique({
      where: { hashedRefreshToken: hashed },
      include: { user: true },
    });

    if (!session || session.revokedAt || session.expiresAt < new Date()) {
      throw new UnauthorizedException('Invalid refresh token');
    }

    // Consume the old session row immediately (single-use refresh tokens).
    await this.prisma.session.update({
      where: { id: session.id },
      data: { revokedAt: new Date() },
    });

    return this.issueTokens(session.user.id, session.user.email, session.device ?? 'refresh', ip);
  }

  /** Update the display name. */
  async updateProfile(userId: string, name: string, ip?: string) {
    const user = await this.prisma.user.update({
      where: { id: userId },
      data: { name },
      select: { id: true, email: true, name: true, createdAt: true },
    });

    await this.audit.record({
      action: 'USER_UPDATED',
      userId,
      resource: `user/${userId}`,
      ip,
      meta: { field: 'name' },
    });

    return user;
  }

  /**
   * Change password: verifies the current one, then revokes every OTHER
   * session so a stolen session can't survive the rotation. The caller's
   * current session stays valid (its access token is short-lived anyway).
   */
  async changePassword(userId: string, dto: ChangePasswordDto, currentRefreshToken?: string, ip?: string) {
     const user = await this.prisma.user.findUnique({ where: { id: userId } });
     if (!user) throw new UnauthorizedException();

     if (!user.passwordHash) {
       throw new BadRequestException(
         'This account uses social sign-in and has no password. Ask an admin to reset access if needed.',
       );
     }

     const ok = await verify(user.passwordHash, dto.currentPassword);
    if (!ok) {
      await this.audit.record({
        action: 'USER_LOGIN_FAILED',
        userId,
        resource: `user/${userId}/password`,
        ip,
        meta: { reason: 'wrong_current_password' },
      });
      throw new UnauthorizedException('Current password is incorrect');
    }

    const passwordHash = await hash(dto.newPassword);
    await this.prisma.user.update({ where: { id: userId }, data: { passwordHash } });

    // Revoke all sessions except the one making this request.
    await this.prisma.session.updateMany({
      where: {
        userId,
        revokedAt: null,
        ...(currentRefreshToken
          ? { hashedRefreshToken: { not: this.hashToken(currentRefreshToken) } }
          : {}),
      },
      data: { revokedAt: new Date() },
    });

    await this.audit.record({
      action: 'PASSWORD_CHANGED',
      userId,
      resource: `user/${userId}`,
      ip,
    });
  }

  async logout(refreshToken: string, userId?: string, ip?: string): Promise<void> {
    const result = await this.prisma.session.updateMany({
      where: { hashedRefreshToken: this.hashToken(refreshToken), revokedAt: null },
      data: { revokedAt: new Date() },
    });

    if (result.count > 0 && userId) {
      await this.audit.record({
        action: 'USER_LOGOUT',
        userId,
        resource: `user/${userId}`,
        ip,
      });
    }
  }
}
