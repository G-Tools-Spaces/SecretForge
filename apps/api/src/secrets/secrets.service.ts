import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { EnvelopeEncryptionService } from '../crypto/envelope-encryption.service';
import { AuditService } from '../audit/audit.service';
import { isValidEnvName, isValidSecretKey, parseEnvContent } from './env-format';

/**
 * Secrets core (Phase 2).
 *
 * Value flow: plaintext → AES-256-GCM with the project's data key → stored as
 * (ciphertext, iv, authTag). The data key is unwrapped from the master key on
 * demand and never persisted in plaintext.
 *
 * Audit rules:
 *  - SECRET_REVEALED / SECRET_READ (export) record every value exposure.
 *  - Values NEVER appear in audit meta (enforced by AuditService sanitization
 *    and covered by tests).
 */
@Injectable()
export class SecretsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: EnvelopeEncryptionService,
    private readonly audit: AuditService,
  ) {}

  /** Resolve an environment by name within a project, or 404. */
  private async resolveEnv(projectId: string, envName: string) {
    if (!isValidEnvName(envName)) {
      throw new BadRequestException(`Invalid environment name: "${envName}"`);
    }
    const env = await this.prisma.environment.findUnique({
      where: { projectId_name: { projectId, name: envName } },
    });
    if (!env) {
      throw new NotFoundException(`Environment "${envName}" not found in this project`);
    }
    return env;
  }

  /** Unwrap the project's data key. */
  private async projectDek(projectId: string): Promise<Buffer> {
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      select: { wrappedDataKey: true },
    });
    if (!project) throw new NotFoundException('Project not found');
    return this.crypto.unwrapDataKey(project.wrappedDataKey);
  }

  /** Masked list for the UI: keys + metadata, never values. */
  async list(projectId: string, envName: string) {
    const env = await this.resolveEnv(projectId, envName);
    const secrets = await this.prisma.secret.findMany({
      where: { environmentId: env.id },
      select: {
        id: true,
        key: true,
        version: true,
        rotatedAt: true,
        updatedAt: true,
        createdAt: true,
        updatedById: true,
      },
      orderBy: { key: 'asc' },
    });
    return { environment: env.name, secrets };
  }

  /** Upsert one secret. Every write creates an immutable version row. */
  async upsert(
    projectId: string,
    envName: string,
    key: string,
    value: string,
    userId: string,
    ip?: string,
  ) {
    if (!isValidSecretKey(key)) {
      throw new BadRequestException(
        `Invalid secret key "${key.slice(0, 40)}": must match ${/^[A-Za-z_][A-Za-z0-9_]*$/}`,
      );
    }
    const env = await this.resolveEnv(projectId, envName);
    const dek = await this.projectDek(projectId);
    const blob = this.crypto.encryptWithKey(dek, value);

    const result = await this.prisma.$transaction(async (tx) => {
      const existing = await tx.secret.findUnique({
        where: { environmentId_key: { environmentId: env.id, key } },
      });

      if (!existing) {
        const secret = await tx.secret.create({
          data: {
            environmentId: env.id,
            key,
            encryptedValue: blob.ciphertext,
            iv: blob.iv,
            authTag: blob.authTag,
            version: 1,
            updatedById: userId,
          },
        });
        await tx.secretVersion.create({
          data: {
            secretId: secret.id,
            encryptedValue: blob.ciphertext,
            iv: blob.iv,
            authTag: blob.authTag,
            version: 1,
            changedById: userId,
          },
        });
        return { secret, created: true };
      }

      const newVersion = existing.version + 1;
      const secret = await tx.secret.update({
        where: { id: existing.id },
        data: {
          encryptedValue: blob.ciphertext,
          iv: blob.iv,
          authTag: blob.authTag,
          version: newVersion,
          rotatedAt: new Date(),
          updatedById: userId,
        },
      });
      await tx.secretVersion.create({
        data: {
          secretId: existing.id,
          encryptedValue: blob.ciphertext,
          iv: blob.iv,
          authTag: blob.authTag,
          version: newVersion,
          changedById: userId,
        },
      });
      return { secret, created: false };
    });

    await this.audit.record({
      action: result.created ? 'SECRET_CREATED' : 'SECRET_UPDATED',
      userId,
      projectId,
      resource: `project/${projectId}/env/${envName}/secret/${key}`,
      ip,
      meta: { version: result.secret.version, env: envName },
    });

    return {
      key,
      version: result.secret.version,
      createdAt: result.created,
      updatedAt: result.secret.updatedAt,
    };
  }

  /** Decrypt one secret. Every reveal is audited (plan security req #6). */
  async reveal(projectId: string, envName: string, key: string, userId: string, ip?: string) {
    const env = await this.resolveEnv(projectId, envName);
    const secret = await this.prisma.secret.findUnique({
      where: { environmentId_key: { environmentId: env.id, key } },
    });
    if (!secret) throw new NotFoundException(`Secret "${key}" not found`);

    const dek = await this.projectDek(projectId);
    let value: string;
    try {
      value = this.crypto
        .decryptWithKey(dek, secret.encryptedValue, secret.iv, secret.authTag)
        .toString('utf8');
    } catch {
      // Decryption failure = wrong master key or tampered data. Never leak
      // which; both are critical incidents.
      throw new ForbiddenException('Secret could not be decrypted (key mismatch or tampering)');
    }

    await this.audit.record({
      action: 'SECRET_REVEALED',
      userId,
      projectId,
      resource: `project/${projectId}/env/${envName}/secret/${key}`,
      ip,
      meta: { version: secret.version, env: envName },
    });

    return { key, value, version: secret.version };
  }

  /** Delete a secret and its version history (cascade). */
  async remove(projectId: string, envName: string, key: string, userId: string, ip?: string) {
    const env = await this.resolveEnv(projectId, envName);
    const secret = await this.prisma.secret.findUnique({
      where: { environmentId_key: { environmentId: env.id, key } },
    });
    if (!secret) throw new NotFoundException(`Secret "${key}" not found`);

    await this.prisma.secret.delete({ where: { id: secret.id } });

    await this.audit.record({
      action: 'SECRET_DELETED',
      userId,
      projectId,
      resource: `project/${projectId}/env/${envName}/secret/${key}`,
      ip,
      meta: { env: envName },
    });
  }

  /** Bulk import from pasted `.env` content. */
  async bulkImport(
    projectId: string,
    envName: string,
    content: string,
    userId: string,
    ip?: string,
  ) {
    const env = await this.resolveEnv(projectId, envName);
    const { keys, invalid } = parseEnvContent(content);
    const keyList = Object.keys(keys);

    if (keyList.length === 0 && invalid.length === 0) {
      throw new BadRequestException('No KEY=value entries found in the import content');
    }
    if (invalid.length > 0) {
      throw new BadRequestException(`Invalid lines/keys in import: ${invalid.join(', ')}`);
    }

    const results = [];
    for (const key of keyList) {
      results.push(await this.upsert(projectId, envName, key, keys[key], userId, ip));
    }

    return {
      environment: env.name,
      imported: results.length,
      created: results.filter((r) => r.createdAt).length,
      updated: results.filter((r) => !r.createdAt).length,
      keys: keyList.sort(),
    };
  }

  /** Export all secrets for an env as `.env` text. Audited as a bulk read. */
  async export(projectId: string, envName: string, userId: string, ip?: string) {
    const env = await this.resolveEnv(projectId, envName);
    const secrets = await this.prisma.secret.findMany({
      where: { environmentId: env.id },
      orderBy: { key: 'asc' },
    });
    if (secrets.length === 0) {
      throw new NotFoundException(`No secrets in environment "${envName}"`);
    }

    const dek = await this.projectDek(projectId);
    const values: Record<string, string> = {};
    for (const s of secrets) {
      values[s.key] = this.crypto
        .decryptWithKey(dek, s.encryptedValue, s.iv, s.authTag)
        .toString('utf8');
    }

    await this.audit.record({
      action: 'SECRET_READ',
      userId,
      projectId,
      resource: `project/${projectId}/env/${envName}/secrets`,
      ip,
      meta: { env: envName, count: secrets.length, purpose: 'export' },
    });

    return { environment: env.name, count: secrets.length, values };
  }

  /** Version history for one secret (metadata only — no values). */
  async versions(projectId: string, envName: string, key: string) {
    const env = await this.resolveEnv(projectId, envName);
    const secret = await this.prisma.secret.findUnique({
      where: { environmentId_key: { environmentId: env.id, key } },
      include: { versions: { orderBy: { version: 'desc' } } },
    });
    if (!secret) throw new NotFoundException(`Secret "${key}" not found`);

    return {
      key,
      currentVersion: secret.version,
      versions: secret.versions.map((v) => ({
        version: v.version,
        changedById: v.changedById,
        changedAt: v.changedAt,
      })),
    };
  }

  /**
   * Roll back to a previous version by COPYING its ciphertext into a new
   * version. History stays append-only — a rollback is itself a new version.
   */
  async rollback(
    projectId: string,
    envName: string,
    key: string,
    targetVersion: number,
    userId: string,
    ip?: string,
  ) {
    const env = await this.resolveEnv(projectId, envName);
    const secret = await this.prisma.secret.findUnique({
      where: { environmentId_key: { environmentId: env.id, key } },
    });
    if (!secret) throw new NotFoundException(`Secret "${key}" not found`);

    const target = await this.prisma.secretVersion.findUnique({
      where: { secretId_version: { secretId: secret.id, version: targetVersion } },
    });
    if (!target) {
      throw new NotFoundException(`Version ${targetVersion} of "${key}" not found`);
    }
    if (targetVersion === secret.version) {
      throw new BadRequestException(`Version ${targetVersion} is already the current version`);
    }

    const newVersion = secret.version + 1;
    await this.prisma.$transaction([
      this.prisma.secret.update({
        where: { id: secret.id },
        data: {
          encryptedValue: target.encryptedValue,
          iv: target.iv,
          authTag: target.authTag,
          version: newVersion,
          rotatedAt: new Date(),
          updatedById: userId,
        },
      }),
      this.prisma.secretVersion.create({
        data: {
          secretId: secret.id,
          encryptedValue: target.encryptedValue,
          iv: target.iv,
          authTag: target.authTag,
          version: newVersion,
          changedById: userId,
        },
      }),
    ]);

    await this.audit.record({
      action: 'SECRET_VERSION_ROLLED_BACK',
      userId,
      projectId,
      resource: `project/${projectId}/env/${envName}/secret/${key}`,
      ip,
      meta: { from: secret.version, to: targetVersion, newVersion, env: envName },
    });

    return { key, version: newVersion, rolledBackTo: targetVersion };
  }
}
