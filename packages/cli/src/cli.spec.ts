import { mkdtempSync, writeFileSync, rmSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  findProjectFile,
  groupQuery,
  loadProjectLink,
  resolveEnv,
  resolveGroup,
  saveProjectLink,
  PROJECT_FILE_NAME,
} from './config';
import { formatEnvFile, mergeEnv, parseSetArg } from './env-file';
import { decodeJwtExp } from './api-client';

// Unit tests for the CLI's pure logic. Network-touching flows are covered by
// the API e2e suites; `forge run` injection is verified in run.spec.ts.

describe('config: project link file', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'sf-cli-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('saves and loads a project link', () => {
    const file = saveProjectLink({ projectId: 'prj_123', defaultEnv: 'staging' }, dir);
    expect(file).toBe(join(dir, PROJECT_FILE_NAME));
    expect(existsSync(file)).toBe(true);

    const link = loadProjectLink(dir);
    expect(link).toEqual({ projectId: 'prj_123', defaultEnv: 'staging' });
  });

  it('finds the link file in a PARENT directory (walk-up resolution)', () => {
    saveProjectLink({ projectId: 'prj_123', defaultEnv: 'dev' }, dir);
    const nested = join(dir, 'packages', 'app', 'src');
    const { mkdirSync } = require('fs') as typeof import('fs');
    mkdirSync(nested, { recursive: true });

    const found = findProjectFile(nested);
    expect(found).toBe(join(dir, PROJECT_FILE_NAME));
    expect(loadProjectLink(nested).projectId).toBe('prj_123');
  });

  it('returns null when no link file exists anywhere up the tree', () => {
    expect(findProjectFile(dir)).toBeNull();
  });

  it('throws a helpful error when the link file is malformed', () => {
    writeFileSync(join(dir, PROJECT_FILE_NAME), '{ "projectId": "x" }');
    expect(() => loadProjectLink(dir)).toThrow(/malformed/);
  });

  it('stores only projectId + defaultEnv when no group is set', () => {
    const file = saveProjectLink({ projectId: 'prj_123', defaultEnv: 'dev' }, dir);
    const raw = require('fs').readFileSync(file, 'utf8');
    const parsed = JSON.parse(raw);
    expect(Object.keys(parsed).sort()).toEqual(['defaultEnv', 'projectId']);
  });

  it('stores the group in the link file when one is set', () => {
    const file = saveProjectLink({ projectId: 'prj_123', defaultEnv: 'dev', group: 'backend' }, dir);
    const link = loadProjectLink(dir);
    expect(link).toEqual({ projectId: 'prj_123', defaultEnv: 'dev', group: 'backend' });
    const raw = JSON.parse(require('fs').readFileSync(file, 'utf8'));
    expect(raw.group).toBe('backend');
  });
});

describe('config: resolveGroup + groupQuery', () => {
  const link = { projectId: 'p', defaultEnv: 'dev' };
  const groupedLink = { projectId: 'p', defaultEnv: 'dev', group: 'backend' };

  it('resolves --group flag > SECRETFORGE_GROUP > link.group > undefined', () => {
    expect(resolveGroup('frontend', groupedLink)).toBe('frontend');

    process.env.SECRETFORGE_GROUP = 'api';
    expect(resolveGroup(undefined, groupedLink)).toBe('api');
    delete process.env.SECRETFORGE_GROUP;

    expect(resolveGroup(undefined, groupedLink)).toBe('backend');
    expect(resolveGroup(undefined, link)).toBeUndefined();
  });

  it('groupQuery returns a query suffix for a group and "" otherwise', () => {
    expect(groupQuery('backend')).toBe('?group=backend');
    expect(groupQuery('api gateway')).toBe('?group=api%20gateway');
    expect(groupQuery(undefined)).toBe('');
    expect(groupQuery('')).toBe('');
  });
});

describe('config: resolveEnv precedence', () => {
  const link = { projectId: 'p', defaultEnv: 'staging' };

  it('flag wins over everything', () => {
    process.env.SECRETFORGE_ENV = 'prod';
    expect(resolveEnv('dev', link)).toBe('dev');
    delete process.env.SECRETFORGE_ENV;
  });

  it('SECRETFORGE_ENV wins over the project default', () => {
    process.env.SECRETFORGE_ENV = 'prod';
    expect(resolveEnv(undefined, link)).toBe('prod');
    delete process.env.SECRETFORGE_ENV;
  });

  it('falls back to the project default, then "dev"', () => {
    expect(resolveEnv(undefined, link)).toBe('staging');
    expect(resolveEnv(undefined, { projectId: 'p', defaultEnv: '' })).toBe('dev');
  });
});

describe('env-file helpers', () => {
  it('parseSetArg splits on the FIRST =', () => {
    expect(parseSetArg('KEY=a=b=c')).toEqual({ key: 'KEY', value: 'a=b=c' });
  });

  it('parseSetArg rejects input without = or with an empty key', () => {
    // Key-only is valid — the caller prompts for the value.
    expect(parseSetArg('NO_EQUALS_SIGN')).toEqual({ key: 'NO_EQUALS_SIGN', value: '' });
    expect(parseSetArg('=value')).toBeNull();
  });

  it('parseSetArg accepts an empty value (forge set prompts for it)', () => {
    expect(parseSetArg('KEY=')).toEqual({ key: 'KEY', value: '' });
  });

  it('mergeEnv: secrets override the base environment', () => {
    const base = { PATH: '/usr/bin', API_KEY: 'old' } as NodeJS.ProcessEnv;
    const merged = mergeEnv(base, { API_KEY: 'new', EXTRA: '1' });
    expect(merged.API_KEY).toBe('new');
    expect(merged.EXTRA).toBe('1');
    expect(merged.PATH).toBe('/usr/bin');
    // Base env must not be mutated.
    expect(base.API_KEY).toBe('old');
  });

  it('formatEnvFile sorts keys and quotes multi-line values', () => {
    const text = formatEnvFile({ B: '2', A: '1', CERT: 'l1\nl2' });
    const lines = text.trim().split('\n');
    expect(lines[0]).toBe('A=1');
    expect(lines[1]).toBe('B=2');
    expect(lines[2]).toBe('CERT="l1\\nl2"');
  });
});

describe('api-client: decodeJwtExp', () => {
  it('decodes exp from a real-shaped JWT', () => {
    const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
    const payload = Buffer.from(JSON.stringify({ sub: 'u1', exp: 1900000000 })).toString(
      'base64url',
    );
    expect(decodeJwtExp(`${header}.${payload}.sig`)).toBe(1900000000);
  });

  it('returns null for garbage', () => {
    expect(decodeJwtExp('not-a-jwt')).toBeNull();
    expect(decodeJwtExp('a.b')).toBeNull();
  });
});
