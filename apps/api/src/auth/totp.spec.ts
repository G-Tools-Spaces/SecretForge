import { createHmac } from 'crypto';
import { base32Decode, base32Encode, generateTotpSecret, otpauthUrl, verifyTotp } from './totp';
import { ipMatches } from '../tokens/tokens.service';

describe('base32', () => {
  test('round-trips RFC 4648 vectors', () => {
    expect(base32Encode(Buffer.from('f'))).toBe('MY');
    expect(base32Encode(Buffer.from('fo'))).toBe('MZXQ');
    expect(base32Encode(Buffer.from('foo'))).toBe('MZXW6');
    expect(base32Encode(Buffer.from('foob'))).toBe('MZXW6YQ');
    expect(base32Encode(Buffer.from('fooba'))).toBe('MZXW6YTB');
    expect(base32Encode(Buffer.from('foobar'))).toBe('MZXW6YTBOI');
    // decode round-trip
    expect(base32Decode('MZXW6YQ').toString()).toBe('foob');
    expect(base32Decode('mzxw6yq').toString()).toBe('foob'); // case-insensitive
  });
});

describe('verifyTotp', () => {
  test('accepts the correct code for the current time step', () => {
    const secret = generateTotpSecret();
    const counter = Math.floor(Date.now() / 30_000);
    const key = base32Decode(secret);
    const buf = Buffer.alloc(8);
    buf.writeBigUInt64BE(BigInt(counter));
    const digest = createHmac('sha1', key).update(buf).digest();
    const offset = digest[digest.length - 1] & 0x0f;
    const code =
      ((digest[offset] & 0x7f) << 24) |
      ((digest[offset + 1] & 0xff) << 16) |
      ((digest[offset + 2] & 0xff) << 8) |
      (digest[offset + 3] & 0xff);
    const six = String(code % 1_000_000).padStart(6, '0');
    expect(verifyTotp(secret, six)).toBe(true);
  });

  test('rejects garbage and wrong codes', () => {
    const secret = generateTotpSecret();
    expect(verifyTotp(secret, '000000')).toBe(false); // astronomically unlikely to be right
    expect(verifyTotp(secret, 'abc')).toBe(false);
    expect(verifyTotp(secret, '')).toBe(false);
    expect(verifyTotp(secret, '12345')).toBe(false);
  });

  test('otpauth URL is well-formed', () => {
    const secret = generateTotpSecret();
    const url = otpauthUrl(secret, 'a@b.com');
    expect(url).toContain('otpauth://totp/');
    expect(url).toContain(`secret=${secret}`);
    expect(url).toContain('period=30');
  });
});

describe('ipMatches (service-token IP allowlist, review M3)', () => {
  test('exact IPv4 match', () => {
    expect(ipMatches('203.0.113.7', '203.0.113.7')).toBe(true);
    expect(ipMatches('203.0.113.7', '203.0.113.8')).toBe(false);
  });

  test('IPv4 CIDR match', () => {
    expect(ipMatches('203.0.113.7', '203.0.113.0/24')).toBe(true);
    expect(ipMatches('203.0.114.7', '203.0.113.0/24')).toBe(false);
    expect(ipMatches('203.0.113.255', '203.0.113.0/24')).toBe(true);
    // non-multiple-of-8 prefix
    expect(ipMatches('10.1.2.3', '10.1.0.0/16')).toBe(true);
    expect(ipMatches('10.2.2.3', '10.1.0.0/16')).toBe(false);
  });

  test('IPv6-mapped IPv4 is normalized', () => {
    expect(ipMatches('::ffff:203.0.113.7', '203.0.113.0/24')).toBe(true);
  });

  test('IPv6 exact and prefix', () => {
    expect(ipMatches('2001:db8::1', '2001:db8::1')).toBe(true);
    expect(ipMatches('2001:db8::2', '2001:db8::/64')).toBe(true);
    expect(ipMatches('2001:db9::2', '2001:db8::/64')).toBe(false);
  });

  test('garbage never matches', () => {
    expect(ipMatches('not-an-ip', '203.0.113.0/24')).toBe(false);
    expect(ipMatches('203.0.113.7', 'garbage')).toBe(false);
  });
});