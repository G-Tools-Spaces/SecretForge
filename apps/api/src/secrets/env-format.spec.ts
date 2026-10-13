import { formatEnvContent, isValidEnvName, isValidSecretKey, parseEnvContent } from './env-format';

describe('env-format helpers', () => {
  describe('isValidSecretKey', () => {
    it('accepts standard env var names', () => {
      expect(isValidSecretKey('API_KEY')).toBe(true);
      expect(isValidSecretKey('_private')).toBe(true);
      expect(isValidSecretKey('a')).toBe(true);
      expect(isValidSecretKey('KEY_2')).toBe(true);
    });

    it('rejects invalid names', () => {
      expect(isValidSecretKey('')).toBe(false);
      expect(isValidSecretKey('1STARTS_WITH_DIGIT')).toBe(false);
      expect(isValidSecretKey('HAS-DASH')).toBe(false);
      expect(isValidSecretKey('HAS SPACE')).toBe(false);
      expect(isValidSecretKey('KEY=INJECTION')).toBe(false);
    });
  });

  describe('isValidEnvName', () => {
    it('accepts dev/staging/prod and custom slugs', () => {
      expect(isValidEnvName('dev')).toBe(true);
      expect(isValidEnvName('staging')).toBe(true);
      expect(isValidEnvName('prod')).toBe(true);
      expect(isValidEnvName('eu-prod-2')).toBe(true);
    });

    it('rejects bad names', () => {
      expect(isValidEnvName('Dev')).toBe(false);
      expect(isValidEnvName('-dev')).toBe(false);
      expect(isValidEnvName('')).toBe(false);
      expect(isValidEnvName('a'.repeat(31))).toBe(false);
    });
  });

  describe('parseEnvContent', () => {
    it('parses basic KEY=value pairs', () => {
      const { keys, invalid } = parseEnvContent('A=1\nB=hello world');
      expect(keys).toEqual({ A: '1', B: 'hello world' });
      expect(invalid).toEqual([]);
    });

    it('splits on the FIRST = (values may contain =)', () => {
      const { keys } = parseEnvContent('DATABASE_URL=postgres://u:p@h/db?ssl=true');
      expect(keys.DATABASE_URL).toBe('postgres://u:p@h/db?ssl=true');
    });

    it('strips matching quotes', () => {
      const { keys } = parseEnvContent(`A="double"\nB='single'`);
      expect(keys).toEqual({ A: 'double', B: 'single' });
    });

    it('keeps unmatched quotes as part of the value', () => {
      const { keys } = parseEnvContent('A="unbalanced');
      expect(keys.A).toBe('"unbalanced');
    });

    it('skips comments and blank lines', () => {
      const { keys, invalid } = parseEnvContent('# comment\n\nA=1\n   \n# another');
      expect(keys).toEqual({ A: '1' });
      expect(invalid).toEqual([]);
    });

    it('strips export prefix', () => {
      const { keys } = parseEnvContent('export A=1');
      expect(keys).toEqual({ A: '1' });
    });

    it('handles CRLF line endings', () => {
      const { keys } = parseEnvContent('A=1\r\nB=2\r\n');
      expect(keys).toEqual({ A: '1', B: '2' });
    });

    it('reports invalid lines and invalid keys separately', () => {
      const { keys, invalid } = parseEnvContent('GOOD=1\nnot an assignment\n1BAD=x');
      expect(keys).toEqual({ GOOD: '1' });
      expect(invalid).toHaveLength(2);
    });

    it('does NOT strip inline trailing comments (values may contain #)', () => {
      const { keys } = parseEnvContent('A=1 # not a comment');
      expect(keys.A).toBe('1 # not a comment');
    });

    it('supports multi-line quoted values', () => {
      const content = 'CERT="line1\nline2"';
      const { keys } = parseEnvContent(content);
      expect(keys.CERT).toBe('line1\nline2');
    });
  });

  describe('formatEnvContent round-trip', () => {
    it('round-trips simple values', () => {
      const values = { A: '1', B: 'two words' };
      const text = formatEnvContent(values);
      expect(parseEnvContent(text).keys).toEqual(values);
    });

    it('round-trips values containing newlines via JSON quoting', () => {
      const values = { CERT: 'line1\nline2' };
      const text = formatEnvContent(values);
      expect(parseEnvContent(text).keys).toEqual(values);
    });

    it('round-trips values starting with a quote', () => {
      const values = { A: '"quoted"' };
      const text = formatEnvContent(values);
      expect(parseEnvContent(text).keys).toEqual(values);
    });

    it('returns empty string for an empty map', () => {
      expect(formatEnvContent({})).toBe('');
    });
  });
});
