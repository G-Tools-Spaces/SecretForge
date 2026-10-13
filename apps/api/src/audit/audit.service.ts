import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export type AuditAction =
  | 'USER_SIGNUP'
  | 'USER_LOGIN'
  | 'USER_LOGIN_FAILED'
  | 'USER_LOGOUT'
  | 'ORG_CREATED'
  | 'ORG_INVITE_CREATED'
  | 'ORG_INVITE_REVOKED'
  | 'ORG_MEMBER_JOINED'
  | 'ORG_MEMBER_ROLE_CHANGED'
  | 'ORG_MEMBER_REMOVED'
  | 'PROJECT_CREATED'
  | 'PROJECT_UPDATED'
  | 'PROJECT_DELETED'
  | 'PROJECT_MEMBER_ADDED'
  | 'PROJECT_MEMBER_ROLE_CHANGED'
  | 'PROJECT_MEMBER_REMOVED'
  // Phase 2+ actions (defined now so audit queries stay stable):
  | 'SECRET_CREATED'
  | 'SECRET_UPDATED'
  | 'SECRET_DELETED'
  | 'SECRET_REVEALED'
  | 'SECRET_READ'
  | 'SECRET_READ_DENIED'
  | 'ACCESS_DENIED'
  | 'SECRET_VERSION_ROLLED_BACK'
  | 'TOKEN_CREATED'
  | 'TOKEN_REVOKED';

export interface AuditEntry {
  action: AuditAction;
  actorType?: 'USER' | 'TOKEN' | 'SYSTEM';
  userId?: string | null;
  orgId?: string | null;
  projectId?: string | null;
  resource: string; // e.g. "project/<id>/env/prod/secret/STRIPE_SECRET_KEY"
  ip?: string | null;
  meta?: Record<string, unknown>;
}

/**
 * Append-only audit trail.
 *
 * CRITICAL RULE (plan security req #6): never log secret VALUES. `meta` is
 * sanitized defensively — any key that smells like a value/secret/token is
 * dropped, and strings are truncated so accidental large payloads can't
 * smuggle values in.
 */
@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  // Keys that must never be persisted, even inside meta objects.
  private static readonly FORBIDDEN_META_KEYS = /^(value|values|secret|plaintext|password|token|refresh_?token|access_?token|authorization)$/i;
  private static readonly MAX_STRING_LEN = 200;

  constructor(private readonly prisma: PrismaService) {}

  /** Strip anything that could contain a secret value before persisting. */
  sanitizeMeta(meta?: Record<string, unknown>): Record<string, unknown> | undefined {
    if (!meta) return undefined;
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(meta)) {
      if (AuditService.FORBIDDEN_META_KEYS.test(k)) continue;
      if (typeof v === 'string') {
        out[k] = v.length > AuditService.MAX_STRING_LEN ? v.slice(0, AuditService.MAX_STRING_LEN) : v;
      } else if (typeof v === 'number' || typeof v === 'boolean' || v === null) {
        out[k] = v;
      } else {
        out[k] = JSON.stringify(v)?.slice(0, AuditService.MAX_STRING_LEN);
      }
    }
    return Object.keys(out).length ? out : undefined;
  }

  async record(entry: AuditEntry): Promise<void> {
    try {
      await this.prisma.auditLog.create({
        data: {
          action: entry.action,
          actorType: entry.actorType ?? 'USER',
          userId: entry.userId ?? null,
          orgId: entry.orgId ?? null,
          projectId: entry.projectId ?? null,
          resource: entry.resource,
          ip: entry.ip ?? null,
          meta: (this.sanitizeMeta(entry.meta) as never) ?? undefined,
        },
      });
    } catch (err) {
      // Audit failures must never break the request path, but they ARE loud:
      // a broken audit trail on a secrets vault is a security incident.
      this.logger.error(`Failed to write audit log for ${entry.action}: ${String(err)}`);
    }
  }
}
