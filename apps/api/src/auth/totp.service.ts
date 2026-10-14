import { BadRequestException, Injectable, UnauthorizedException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { EnvelopeEncryptionService } from '../crypto/envelope-encryption.service';
import { MasterKeyService } from '../crypto/master-key.service';
import { AuditService } from '../audit/audit.service';
import { generateTotpSecret, otpauthUrl, verifyTotp } from './totp';

/**
 * TOTP two-factor authentication (Phase 7 / review M4).
 *
 * Storage: the secret is AES-256-GCM-encrypted with the MASTER KEY (not a
 * project DEK — user secrets are a different branch of the hierarchy) and
 * stored as "<ciphertext>.<iv>.<authTag>" in User.totpSecret. `totpEnabled`
 * only flips true after the user proves they scanned it (verify at setup).
 *
 * Login flow: password OK + totpEnabled → respond 401 with
 * `totp_required: true` (never issue tokens) → client re-posts with a code.
 */
@Injectable()
export class TotpService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: EnvelopeEncryptionService,
    private readonly masterKey: MasterKeyService,
    private readonly audit: AuditService,
  ) {}

  /** Encrypt a base32 secret with the master key for at-rest storage. */
  private encryptSecret(secretBase32: string): string {
    const { ciphertext, iv, authTag } = this.crypto.encryptWithKey(
      this.masterKey.key,
      secretBase32,
    );
    return `${ciphertext}.${iv}.${authTag}`;
  }

  /** Decrypt an at-rest secret back to base32. */
  private decryptSecret(stored: string): string {
    const [ciphertext, iv, authTag] = stored.split('.');
    return this.crypto
      .decryptWithKey(this.masterKey.key, ciphertext, iv, authTag)
      .toString('utf8');
  }

  /**
   * Step 1 of setup: mint a fresh secret, store it (disabled), and return the
   * otpauth URL + base32 secret for the user's authenticator app.
   */
  async startSetup(userId: string, email: string) {
    const secret = generateTotpSecret();
    await this.prisma.user.update({
      where: { id: userId },
      data: { totpSecret: this.encryptSecret(secret), totpEnabled: false },
    });
    return { secret, otpauthUrl: otpauthUrl(secret, email) };
  }

  /** Step 2 of setup: verify a code from the app, then enable 2FA. */
  async enable(userId: string, code: string, ip?: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user?.totpSecret) {
      throw new BadRequestException('Start 2FA setup first (POST /auth/totp/setup)');
    }
    const secret = this.decryptSecret(user.totpSecret);
    if (!verifyTotp(secret, code)) {
      throw new BadRequestException('That code is invalid or has expired — try the next one');
    }
    await this.prisma.user.update({ where: { id: userId }, data: { totpEnabled: true } });
    await this.audit.record({
      action: 'USER_UPDATED',
      userId,
      resource: `user/${userId}`,
      ip,
      meta: { field: 'totp_enabled' },
    });
    return { enabled: true };
  }

  /** Disable 2FA (requires a valid current code — not just a password). */
  async disable(userId: string, code: string, ip?: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user?.totpEnabled || !user.totpSecret) {
      throw new BadRequestException('2FA is not enabled on this account');
    }
    const secret = this.decryptSecret(user.totpSecret);
    if (!verifyTotp(secret, code)) {
      throw new UnauthorizedException('Invalid 2FA code');
    }
    await this.prisma.user.update({
      where: { id: userId },
      data: { totpSecret: null, totpEnabled: false },
    });
    await this.audit.record({
      action: 'USER_UPDATED',
      userId,
      resource: `user/${userId}`,
      ip,
      meta: { field: 'totp_disabled' },
    });
    return { enabled: false };
  }

  /** Is 2FA active for this user? (For the account page.) */
  async status(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { totpEnabled: true },
    });
    return { enabled: user?.totpEnabled ?? false };
  }

  /**
   * Login step 2: verify a code for a user who has 2FA enabled.
   * Returns true/false — the caller decides whether to issue tokens.
   */
  async verifyLogin(userId: string, code: string): Promise<boolean> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user?.totpEnabled || !user.totpSecret) return true; // no 2FA → pass
    const secret = this.decryptSecret(user.totpSecret);
    return verifyTotp(secret, code);
  }
}