import { Injectable } from '@nestjs/common';

/**
 * Loads the master key from the environment.
 *
 * The master key is the root of the envelope-encryption hierarchy: it wraps
 * (encrypts) each project's data key, which in turn encrypts secret values.
 * It must NEVER be stored in the database or committed to the repo — only
 * provided via the SECRETFORGE_MASTER_KEY environment variable (base64, 32 bytes).
 */
@Injectable()
export class MasterKeyService {
  private readonly masterKey: Buffer;

  constructor(masterKeyB64: string) {
    if (!masterKeyB64) {
      throw new Error(
        'SECRETFORGE_MASTER_KEY is not set. Generate one with: openssl rand -base64 32',
      );
    }
    const key = Buffer.from(masterKeyB64, 'base64');
    if (key.length !== 32) {
      throw new Error(
        `SECRETFORGE_MASTER_KEY must decode to 32 bytes (256 bits) for AES-256-GCM, got ${key.length}.`,
      );
    }
    this.masterKey = key;
  }

  /** The raw 32-byte master key. Only used by EnvelopeEncryptionService. */
  get key(): Buffer {
    return this.masterKey;
  }
}
