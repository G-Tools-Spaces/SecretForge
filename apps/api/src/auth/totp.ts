import { createHmac, randomBytes } from 'crypto';

/**
 * Dependency-free TOTP (RFC 6238) + HOTP (RFC 4226) utilities.
 *
 * Used for optional two-factor authentication on login. The secret is stored
 * AES-256-GCM-encrypted (see TotpService); this module only handles the math.
 */

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

/** Encode a Buffer as unpadded base32 (RFC 4648). */
export function base32Encode(buf: Buffer): string {
  let bits = 0;
  let value = 0;
  let output = '';
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) {
    output += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  }
  return output;
}

/** Decode an unpadded base32 string (case-insensitive). */
export function base32Decode(input: string): Buffer {
  const clean = input.toUpperCase().replace(/[^A-Z2-7]/g, '');
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];
  for (const char of clean) {
    value = (value << 5) | BASE32_ALPHABET.indexOf(char);
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

/** Generate a new 20-byte (160-bit) TOTP secret, base32-encoded. */
export function generateTotpSecret(): string {
  return base32Encode(randomBytes(20));
}

/** RFC 4226 HOTP, SHA-1, 6 digits, dynamic truncation. */
function hotp(secret: Buffer, counter: number): string {
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64BE(BigInt(counter));
  const digest = createHmac('sha1', secret).update(buf).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  const code =
    ((digest[offset] & 0x7f) << 24) |
    ((digest[offset + 1] & 0xff) << 16) |
    ((digest[offset + 2] & 0xff) << 8) |
    (digest[offset + 3] & 0xff);
  return String(code % 1_000_000).padStart(6, '0');
}

/**
 * Verify a 6-digit TOTP code with a ±1 step (30 s) drift window — the
 * standard allowance for clock skew. Constant-time-ish comparison.
 */
export function verifyTotp(secretBase32: string, code: string, window = 1): boolean {
  const normalized = (code ?? '').replace(/\s/g, '');
  if (!/^\d{6}$/.test(normalized)) return false;
  const secret = base32Decode(secretBase32);
  const counter = Math.floor(Date.now() / 30_000);
  for (let drift = -window; drift <= window; drift++) {
    const expected = hotp(secret, counter + drift);
    if (timingSafeEqualString(normalized, expected)) return true;
  }
  return false;
}

function timingSafeEqualString(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

/** otpauth:// URL for authenticator apps (QR-encodable). */
export function otpauthUrl(secretBase32: string, email: string, issuer = 'SecretForge'): string {
  const label = encodeURIComponent(`${issuer}:${email}`);
  return (
    `otpauth://totp/${label}?secret=${secretBase32}` +
    `&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`
  );
}