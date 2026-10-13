import { Injectable } from '@nestjs/common';
import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';
import { MasterKeyService } from './master-key.service';

export interface EncryptedBlob {
  /** base64 ciphertext */
  ciphertext: string;
  /** base64 IV — unique per encryption */
  iv: string;
  /** base64 GCM auth tag */
  authTag: string;
}

/**
 * Envelope encryption:
 *
 *   master key (env var, never in DB)
 *       └── wraps ──► per-project data key (stored wrapped in Project.wrappedDataKey)
 *                         └── encrypts ──► secret values (stored in Secret.encryptedValue)
 *
 * Every encryption uses AES-256-GCM with a fresh random IV, so encrypting the
 * same value twice never yields the same ciphertext, and any tampering with
 * ciphertext/IV is detected via the auth tag.
 */
@Injectable()
export class EnvelopeEncryptionService {
  constructor(private readonly masterKey: MasterKeyService) {}

  /**
   * Generate a new per-project data key, wrapped by the master key.
   * Returns the string to store in `Project.wrappedDataKey`:
   * "<ciphertext>.<iv>.<authTag>" (all parts base64).
   */
  generateWrappedDataKey(): string {
    const dataKey = randomBytes(32); // the plaintext DEK never touches the DB
    const { ciphertext, iv, authTag } = this.encryptWithKey(this.masterKey.key, dataKey);
    return `${ciphertext}.${iv}.${authTag}`;
  }

  /** Unwrap a project data key using the master key. */
  unwrapDataKey(wrappedDataKey: string): Buffer {
    const parts = wrappedDataKey.split('.');
    if (parts.length !== 3) {
      throw new Error('Malformed wrapped data key');
    }
    const [ciphertext, iv, authTag] = parts;
    return this.decryptWithKey(this.masterKey.key, ciphertext, iv, authTag);
  }

  /** Encrypt a plaintext string with a 32-byte key. AES-256-GCM, unique IV. */
  encryptWithKey(key: Buffer, plaintext: string | Buffer): EncryptedBlob {
    if (key.length !== 32) {
      throw new Error(`Key must be 32 bytes for AES-256-GCM, got ${key.length}`);
    }
    const iv = randomBytes(12); // 96-bit IV — the GCM standard recommendation
    const cipher = createCipheriv('aes-256-gcm', key, iv);
    const data = Buffer.isBuffer(plaintext) ? plaintext : Buffer.from(plaintext, 'utf8');
    const ciphertext = Buffer.concat([cipher.update(data), cipher.final()]);
    return {
      ciphertext: ciphertext.toString('base64'),
      iv: iv.toString('base64'),
      authTag: cipher.getAuthTag().toString('base64'),
    };
  }

  /** Decrypt an EncryptedBlob with a 32-byte key. Throws if the auth tag fails. */
  decryptWithKey(key: Buffer, ciphertext: string, iv: string, authTag: string): Buffer {
    if (key.length !== 32) {
      throw new Error(`Key must be 32 bytes for AES-256-GCM, got ${key.length}`);
    }
    const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64'));
    decipher.setAuthTag(Buffer.from(authTag, 'base64'));
    return Buffer.concat([
      decipher.update(Buffer.from(ciphertext, 'base64')),
      decipher.final(),
    ]);
  }

  /** Convenience: encrypt + decrypt a UTF-8 string round-trip helper for callers. */
  decryptString(key: Buffer, blob: EncryptedBlob): string {
    return this.decryptWithKey(key, blob.ciphertext, blob.iv, blob.authTag).toString('utf8');
  }
}
