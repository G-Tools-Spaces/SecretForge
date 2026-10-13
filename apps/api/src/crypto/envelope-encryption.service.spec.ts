import { createHash, randomBytes } from 'crypto';
import { EnvelopeEncryptionService } from './envelope-encryption.service';
import { MasterKeyService } from './master-key.service';

// Tests written BEFORE the implementation, per the plan doc:
// "write tests for the encryption and authorization logic first".

const MASTER_KEY_B64 = randomBytes(32).toString('base64');

function makeService(): EnvelopeEncryptionService {
  return new EnvelopeEncryptionService(new MasterKeyService(MASTER_KEY_B64));
}

describe('MasterKeyService', () => {
  it('accepts a valid 32-byte base64 key', () => {
    expect(() => new MasterKeyService(MASTER_KEY_B64)).not.toThrow();
  });

  it('rejects a missing key', () => {
    expect(() => new MasterKeyService('')).toThrow(/SECRETFORGE_MASTER_KEY/);
  });

  it('rejects a key of the wrong length', () => {
    expect(() => new MasterKeyService(Buffer.alloc(16).toString('base64'))).toThrow(/32 bytes/);
  });
});

describe('EnvelopeEncryptionService', () => {
  let svc: EnvelopeEncryptionService;
  const dataKey = randomBytes(32);

  beforeEach(() => {
    svc = makeService();
  });

  describe('encryptWithKey / decryptWithKey', () => {
    it('round-trips a plaintext value', () => {
      const blob = svc.encryptWithKey(dataKey, 'postgres://user:pass@host/db');
      expect(svc.decryptString(dataKey, blob)).toBe('postgres://user:pass@host/db');
    });

    it('round-trips unicode and multi-line values', () => {
      const value = 'pässwörd-🔐\nline2\ttabbed';
      const blob = svc.encryptWithKey(dataKey, value);
      expect(svc.decryptString(dataKey, blob)).toBe(value);
    });

    it('round-trips an empty value', () => {
      const blob = svc.encryptWithKey(dataKey, '');
      expect(svc.decryptString(dataKey, blob)).toBe('');
    });

    it('round-trips binary data (private keys)', () => {
      const data = randomBytes(2048);
      const blob = svc.encryptWithKey(dataKey, data);
      expect(svc.decryptWithKey(dataKey, blob.ciphertext, blob.iv, blob.authTag).equals(data)).toBe(
        true,
      );
    });

    it('uses a unique IV for every encryption (same plaintext → different ciphertext)', () => {
      const a = svc.encryptWithKey(dataKey, 'same-value');
      const b = svc.encryptWithKey(dataKey, 'same-value');
      expect(a.iv).not.toBe(b.iv);
      expect(a.ciphertext).not.toBe(b.ciphertext);
    });

    it('produces ciphertext that does not contain the plaintext', () => {
      const blob = svc.encryptWithKey(dataKey, 'SUPER_SECRET_PLAINTEXT');
      const raw = Buffer.from(blob.ciphertext, 'base64').toString('binary');
      expect(raw).not.toContain('SUPER_SECRET_PLAINTEXT');
    });

    it('throws when ciphertext is tampered with (GCM auth tag)', () => {
      const blob = svc.encryptWithKey(dataKey, 'value');
      const bytes = Buffer.from(blob.ciphertext, 'base64');
      bytes[0] ^= 0xff; // flip a bit
      expect(() =>
        svc.decryptWithKey(dataKey, bytes.toString('base64'), blob.iv, blob.authTag),
      ).toThrow();
    });

    it('throws when the auth tag is tampered with', () => {
      const blob = svc.encryptWithKey(dataKey, 'value');
      const tag = Buffer.from(blob.authTag, 'base64');
      tag[0] ^= 0xff;
      expect(() =>
        svc.decryptWithKey(dataKey, blob.ciphertext, blob.iv, tag.toString('base64')),
      ).toThrow();
    });

    it('throws when decrypting with the wrong key', () => {
      const blob = svc.encryptWithKey(dataKey, 'value');
      const wrongKey = randomBytes(32);
      expect(() => svc.decryptWithKey(wrongKey, blob.ciphertext, blob.iv, blob.authTag)).toThrow();
    });

    it('rejects keys that are not 32 bytes', () => {
      expect(() => svc.encryptWithKey(randomBytes(16), 'x')).toThrow(/32 bytes/);
    });
  });

  describe('data key wrapping (envelope encryption)', () => {
    it('generates a wrapped data key that unwraps to 32 bytes', () => {
      const wrapped = svc.generateWrappedDataKey();
      const unwrapped = svc.unwrapDataKey(wrapped);
      expect(unwrapped.length).toBe(32);
    });

    it('generates a different data key each time', () => {
      const a = svc.unwrapDataKey(svc.generateWrappedDataKey());
      const b = svc.unwrapDataKey(svc.generateWrappedDataKey());
      expect(a.equals(b)).toBe(false);
    });

    it('does not embed the raw data key in the wrapped representation', () => {
      const wrapped = svc.generateWrappedDataKey();
      const raw = svc.unwrapDataKey(wrapped);
      const wrappedBytes = Buffer.from(wrapped, 'binary');
      // The wrapped form must not contain the raw DEK bytes anywhere.
      expect(wrappedBytes.includes(raw)).toBe(false);
    });

    it('full envelope round-trip: wrap DEK → encrypt secret → unwrap → decrypt', () => {
      const wrapped = svc.generateWrappedDataKey();
      const dek = svc.unwrapDataKey(wrapped);
      const blob = svc.encryptWithKey(dek, 'sk_live_abc123');
      expect(svc.decryptString(dek, blob)).toBe('sk_live_abc123');
    });

    it('rejects a malformed wrapped key', () => {
      expect(() => svc.unwrapDataKey('not-a-wrapped-key')).toThrow(/Malformed/);
    });

    it('fails to unwrap with a different master key (key rotation scenario)', () => {
      const otherSvc = new EnvelopeEncryptionService(
        new MasterKeyService(randomBytes(32).toString('base64')),
      );
      const wrapped = svc.generateWrappedDataKey();
      expect(() => otherSvc.unwrapDataKey(wrapped)).toThrow();
    });
  });

  describe('master key hygiene', () => {
    it('never exposes the master key in wrapped output', () => {
      const wrapped = svc.generateWrappedDataKey();
      const masterKeyHash = createHash('sha256')
        .update(Buffer.from(MASTER_KEY_B64, 'base64'))
        .digest();
      expect(Buffer.from(wrapped, 'binary').includes(masterKeyHash)).toBe(false);
    });
  });
});
