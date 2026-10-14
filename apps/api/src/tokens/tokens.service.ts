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
 * Match a request IP against an allowlist entry. Supports exact IPs and
 * CIDR prefixes (e.g. "203.0.113.0/24"). IPv6-mapped IPv4 ("::ffff:1.2.3.4")
 * is normalized to plain IPv4 first.
 */
export function ipMatches(requestIp: string, entry: string): boolean {
  const ip = requestIp.startsWith('::ffff:') ? requestIp.slice(7) : requestIp;
  const rule = entry.trim();
  if (rule === ip) return true;

  // CIDR: compare the first N bits.
  const slash = rule.indexOf('/');
  if (slash > 0) {
    const [base, bitsStr] = [rule.slice(0, slash), rule.slice(slash + 1)];
    const bits = parseInt(bitsStr, 10);
    if (Number.isNaN(bits)) return false;
    const a = ipToBytes(ip);
    const b = ipToBytes(base);
    if (!a || !b || a.length !== b.length) return false;
    const fullBytes = Math.floor(bits / 8);
    const remBits = bits % 8;
    for (let i = 0; i < fullBytes; i++) {
      if (a[i] !== b[i]) return false;
    }
    if (remBits > 0 && fullBytes < a.length) {
      const mask = 0xff << (8 - remBits);
      if ((a[fullBytes] & mask) !== (b[fullBytes] & mask)) return false;
    }
    return true;
  }
  return false;
}

function ipToBytes(ip: string): number[] | null {
  if (ip.includes('.')) {
    const parts = ip.split('.');
    if (parts.length !== 4) return null;
    const bytes = parts.map((p) => parseInt(p, 10));
    if (bytes.some((b) => Number.isNaN(b) || b < 0 || b > 255)) return null;
    return bytes;
  }
  // IPv6: expand "::" and parse hex groups.
  const [head, tail] = ip.split('::');
  const headGroups = head ? head.split(':').filter(Boolean) : [];
  const tailGroups = tail !== undefined ? (tail ? tail.split(':').filter(Boolean) : []) : [];
  const missing = tail !== undefined ? 8 - headGroups.length - tailGroups.length : 0;
  if (tail !== undefined && missing < 0) return null;
  const groups =
    tail !== undefined
      ? [...headGroups, ...Array(missing).fill('0'), ...tailGroups]
      : headGroups;
  if (groups.length !== 8) return null;
  const bytes: number[] = [];
  for (const g of groups) {
    const v = parseInt(g, 16);
    if (Number.isNaN(v) || v < 0 || v > 0xffff) return null;
    bytes.push((v >> 8) & 0xff, v & 0xff);
  }
  return bytes;
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

    // Review M3: enforce the token's IP allowlist (empty = allow all).
    if (token.ipAllowlist.length > 0 && ip) {
      const allowed = token.ipAllowlist.some((entry) => ipMatches(ip, entry));
      if (!allowed) {
        await deny('ip_not_allowed', 'Service token is not allowed from this IP address');
      }
    }

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
