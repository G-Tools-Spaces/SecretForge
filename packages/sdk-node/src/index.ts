import { existsSync, readFileSync } from 'fs';
import { dirname, join, resolve } from 'path';

/**
 * SecretForge Node SDK (Phase 6).
 *
 * Fetches decrypted secrets over HTTPS at process boot and (optionally)
 * merges them into `process.env`. Nothing is written to disk.
 *
 * Auth: service tokens only (plan req #7 — read-only, single-env, expiring,
 * revocable). User JWTs are intentionally NOT supported here: apps in CI and
 * servers should never carry a user's session.
 *
 * ```ts
 * import { config } from '@gtools-spaces/sdk';
 * await config(); // process.env now has your secrets
 * ```
 */

export interface ForgeOptions {
  /** Project ID. Default: `.secretforge.json` discovered upward from cwd. */
  projectId?: string;
  /** Environment name. Default: SECRETFORGE_ENV > link defaultEnv > "dev". */
  env?: string;
  /** Service token (`sf_...`). Default: SECRETFORGE_TOKEN env var. */
  token?: string;
  /** API base URL. Default: SECRETFORGE_URL env var > http://localhost:4000. */
  url?: string;
}

export class ForgeError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
  ) {
    super(message);
    this.name = 'ForgeError';
  }
}

const PROJECT_FILE_NAME = '.secretforge.json';

interface ProjectLink {
  projectId: string;
  defaultEnv: string;
}

/** Walk up from `startDir` looking for `.secretforge.json` (like the CLI). */
function findProjectFile(startDir: string): string | null {
  let dir = resolve(startDir);
  for (;;) {
    const candidate = join(dir, PROJECT_FILE_NAME);
    if (existsSync(candidate)) return candidate;
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

function loadProjectLink(startDir: string): ProjectLink | null {
  const file = findProjectFile(startDir);
  if (!file) return null;
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8'));
    if (parsed.projectId && parsed.defaultEnv) {
      return { projectId: parsed.projectId, defaultEnv: parsed.defaultEnv };
    }
  } catch {
    /* malformed link file — treated as absent */
  }
  return null;
}

interface ResolvedOptions {
  projectId: string;
  env: string;
  token: string;
  url: string;
}

function resolveOptions(opts: ForgeOptions): ResolvedOptions {
  const link = loadProjectLink(process.cwd());

  const projectId = opts.projectId ?? link?.projectId;
  if (!projectId) {
    throw new ForgeError(
      `No projectId provided and no ${PROJECT_FILE_NAME} found. ` +
        'Pass { projectId } or run `forge init` in your repo.',
    );
  }

  const token = opts.token ?? process.env.SECRETFORGE_TOKEN;
  if (!token) {
    throw new ForgeError(
      'No service token. Set SECRETFORGE_TOKEN or pass { token }. ' +
        'Create one in the web UI under Project → Tokens.',
    );
  }

  const env = opts.env ?? process.env.SECRETFORGE_ENV ?? link?.defaultEnv ?? 'dev';
  const url = (opts.url ?? process.env.SECRETFORGE_URL ?? 'http://localhost:4000').replace(/\/+$/, '');

  return { projectId, env, token, url };
}

/**
 * Fetch all secrets for the environment as a plain object.
 * Does NOT touch process.env — use `config()` for that.
 */
export async function load(opts: ForgeOptions = {}): Promise<Record<string, string>> {
  const { projectId, env, token, url } = resolveOptions(opts);

  const res = await fetch(
    `${url}/projects/${encodeURIComponent(projectId)}/envs/${encodeURIComponent(env)}/secrets/export`,
    { headers: { authorization: `Bearer ${token}` } },
  );

  if (!res.ok) {
    let message = `SecretForge request failed (${res.status})`;
    try {
      const body = (await res.json()) as { message?: unknown };
      if (body?.message) message = String(body.message);
    } catch {
      /* non-JSON error body */
    }
    throw new ForgeError(message, res.status);
  }

  const body = (await res.json()) as { values: Record<string, string> };
  return body.values;
}

/**
 * Fetch secrets and merge them into `process.env` (existing variables win —
 * real environment always overrides the vault). Returns the loaded values.
 */
export async function config(opts: ForgeOptions = {}): Promise<Record<string, string>> {
  const values = await load(opts);
  for (const [key, value] of Object.entries(values)) {
    if (process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
  return values;
}

export default { load, config };
