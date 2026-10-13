import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { createHash, randomBytes } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { isValidEnvName } from '../secrets/env-format';

/** Identity of a validated service token, attached to the request. */
export interface ServiceTokenActor {
  id: string;
  name: string;
  environmentId: string;
  projectId: string;
  environment: string;
}

function sha256(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}

/**
 * Service tokens (Phase 6, plan security req #7): read-only, scoped to ONE
 * environment, expiring, revocable. Used by CI/servers via SECRETFORGE_TOKEN.
 *
 * Storage rule: only the SHA-256 hash is persisted — the plaintext `sf_...`
 * token is shown exactly once at creation and never recoverable afterwards.
 */
@Injectable()
export class TokensService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /** Mint a new token for an environment. Returns the plaintext ONCE. */
  async create(
    projectId: string,
    envName: string,
    name: string,
    expiresInDays: number,
    userId: string,
    ip?: string,
  ) {
    if (!isValidEnvName(envName)) {
      throw new BadRequestException(`Invalid environment name: "${envName}"`);
    }
    const env = await this.prisma.environment.findUnique({
      where: { projectId_name: { projectId, name: envName } },
    });
    if (!env) {
      throw new NotFoundException(`Environment "${envName}" not found in this project`);
    }

    const plaintext = `sf_${randomBytes(24).toString('hex')}`; // sf_ + 48 hex chars
    const expiresAt = new Date(Date.now() + expiresInDays * 86_400_000);

    const token = await this.prisma.serviceToken.create({
      data: {
        environmentId: env.id,
        name,
        hashedToken: sha256(plaintext),
        tokenPrefix: plaintext.slice(0, 10),
        expiresAt,
      },
    });

    await this.audit.record({
      action: 'TOKEN_CREATED',
      userId,
      projectId,
      resource: `project/${projectId}/env/${envName}/token/${token.id}`,
      ip,
      meta: { name, env: envName, expiresInDays },
    });

    return {
      id: token.id,
      name: token.name,
      environment: env.name,
      token: plaintext, // shown once — never stored
      expiresAt: token.expiresAt,
    };
  }

  /** All tokens across a project's environments (metadata only). */
  async list(projectId: string) {
    const tokens = await this.prisma.serviceToken.findMany({
      where: { environment: { projectId } },
      include: { environment: { select: { name: true } } },
      orderBy: { createdAt: 'desc' },
    });
    return {
      tokens: tokens.map((t) => ({
        id: t.id,
        name: t.name,
        environment: t.environment.name,
        prefix: t.tokenPrefix,
        scope: t.scope,
        expiresAt: t.expiresAt,
        revokedAt: t.revokedAt,
        lastUsedAt: t.lastUsedAt,
        createdAt: t.createdAt,
      })),
    };
  }

  /** Revoke a token (idempotent-ish: revoking twice is a 400). */
  async revoke(projectId: string, tokenId: string, userId: string, ip?: string) {
    const token = await this.prisma.serviceToken.findFirst({
      where: { id: tokenId, environment: { projectId } },
      include: { environment: { select: { name: true } } },
    });
    if (!token) throw new NotFoundException('Token not found in this project');
    if (token.revokedAt) throw new BadRequestException('Token is already revoked');

    await this.prisma.serviceToken.update({
      where: { id: token.id },
      data: { revokedAt: new Date() },
    });

    await this.audit.record({
      action: 'TOKEN_REVOKED',
      userId,
      projectId,
      resource: `project/${projectId}/env/${token.environment.name}/token/${token.id}`,
      ip,
      meta: { name: token.name, env: token.environment.name },
    });
  }

  /**
   * Validate a presented `sf_...` token for a secrets route. Enforces the
   * env scope: the token only works for the exact :projectId/:env it was
   * created for. Denials are audited with actorType TOKEN.
   */
  async validateForRequest(
    presented: string,
    projectId: string,
    envName: string,
    ip?: string,
  ): Promise<ServiceTokenActor> {
    const token = await this.prisma.serviceToken.findUnique({
      where: { hashedToken: sha256(presented) },
      include: { environment: true },
    });

    if (!token) {
      throw new UnauthorizedException('Invalid service token');
    }

    const deny = async (reason: string, message: string): Promise<never> => {
      await this.audit.record({
        action: 'ACCESS_DENIED',
        actorType: 'TOKEN',
        projectId: token.environment.projectId,
        resource: `project/${projectId}/env/${envName}/secrets`,
        ip,
        meta: { reason, tokenName: token.name },
      });
      throw new UnauthorizedException(message);
    };

    if (token.revokedAt) await deny('token_revoked', 'Service token has been revoked');
    if (token.expiresAt.getTime() < Date.now()) await deny('token_expired', 'Service token has expired');

    if (token.environment.projectId !== projectId || token.environment.name !== envName) {
      await this.audit.record({
        action: 'ACCESS_DENIED',
        actorType: 'TOKEN',
        projectId: token.environment.projectId,
        resource: `project/${projectId}/env/${envName}/secrets`,
        ip,
        meta: {
          reason: 'wrong_scope',
          tokenName: token.name,
          tokenEnv: token.environment.name,
        },
      });
      throw new ForbiddenException('Token is not valid for this project/environment');
    }

    // Best-effort usage stamp; failure must not block the read.
    this.prisma.serviceToken
      .update({ where: { id: token.id }, data: { lastUsedAt: new Date() } })
      .catch(() => {});

    return {
      id: token.id,
      name: token.name,
      environmentId: token.environmentId,
      projectId,
      environment: envName,
    };
  }
}
