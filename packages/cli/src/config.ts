import { existsSync, readFileSync, writeFileSync, chmodSync, mkdirSync, unlinkSync } from 'fs';
import { homedir } from 'os';
import { dirname, join, resolve } from 'path';

/**
 * CLI configuration.
 *
 *  - Global credentials live in ~/.secretforge/credentials.json (chmod 600).
 *  - Per-project link file `.secretforge.json` lives in the repo (safe to
 *    commit: only the project ID + default environment name).
 */

export const CONFIG_DIR = join(homedir(), '.secretforge');
export const CREDENTIALS_FILE = join(CONFIG_DIR, 'credentials.json');
export const PROJECT_FILE_NAME = '.secretforge.json';

export interface ProjectLink {
  projectId: string;
  defaultEnv: string;
}

export interface Credentials {
  apiUrl: string;
  email: string;
  accessToken: string;
  refreshToken: string;
}

/** API base URL: SECRETFORGE_URL env var, or local default. */
export function defaultApiUrl(): string {
  const url = process.env.SECRETFORGE_URL || 'http://localhost:4000';
  return url.replace(/\/+$/, ''); // strip trailing slashes
}

/**
 * Walk up from `startDir` looking for `.secretforge.json` (like package.json
 * resolution) so `forge run` works from any subdirectory of the repo.
 */
export function findProjectFile(startDir: string = process.cwd()): string | null {
  let dir = resolve(startDir);
  for (;;) {
    const candidate = join(dir, PROJECT_FILE_NAME);
    if (existsSync(candidate)) return candidate;
    const parent = dirname(dir);
    if (parent === dir) return null; // reached filesystem root
    dir = parent;
  }
}

export function loadProjectLink(startDir: string = process.cwd()): ProjectLink {
  const file = findProjectFile(startDir);
  if (!file) {
    throw new Error(
      `No ${PROJECT_FILE_NAME} found in this directory or any parent.\n` +
        `Run \`forge init\` first (or use --project to target a project explicitly).`,
    );
  }
  const parsed = JSON.parse(readFileSync(file, 'utf8'));
  if (!parsed.projectId || !parsed.defaultEnv) {
    throw new Error(`${file} is malformed: expected { "projectId", "defaultEnv" }`);
  }
  return { projectId: parsed.projectId, defaultEnv: parsed.defaultEnv };
}

export function saveProjectLink(link: ProjectLink, dir: string = process.cwd()): string {
  const file = join(dir, PROJECT_FILE_NAME);
  writeFileSync(file, JSON.stringify({ projectId: link.projectId, defaultEnv: link.defaultEnv }, null, 2) + '\n');
  return file;
}

export function loadCredentials(): Credentials | null {
  if (!existsSync(CREDENTIALS_FILE)) return null;
  try {
    const parsed = JSON.parse(readFileSync(CREDENTIALS_FILE, 'utf8'));
    if (!parsed.accessToken || !parsed.refreshToken || !parsed.apiUrl) return null;
    return parsed as Credentials;
  } catch {
    return null;
  }
}

export function saveCredentials(creds: Credentials): void {
  mkdirSync(CONFIG_DIR, { recursive: true, mode: 0o700 });
  writeFileSync(CREDENTIALS_FILE, JSON.stringify(creds, null, 2) + '\n');
  chmodSync(CREDENTIALS_FILE, 0o600); // tokens are as sensitive as passwords
}

export function clearCredentials(): void {
  if (existsSync(CREDENTIALS_FILE)) unlinkSync(CREDENTIALS_FILE);
}

/**
 * Environment resolution order:
 *   --env flag > SECRETFORGE_ENV env var > project link defaultEnv > "dev"
 */
export function resolveEnv(flagEnv: string | undefined, link: ProjectLink): string {
  return flagEnv || process.env.SECRETFORGE_ENV || link.defaultEnv || 'dev';
}
