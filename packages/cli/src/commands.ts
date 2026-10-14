import { existsSync, readFileSync, writeFileSync } from 'fs';
import { spawn } from 'child_process';
import { prompt, promptHidden } from './prompt';
import {
  Credentials,
  ProjectLink,
  findProjectFile,
  loadCredentials,
  loadProjectLink,
  groupQuery,
  resolveEnv,
  resolveGroup,
  saveProjectLink,
} from './config';
import { ApiClient, ApiError, requireClient } from './api-client';
import { formatEnvFile, mergeEnv, parseSetArg } from './env-file';

/** Human-friendly error → exit code mapping. */
function fail(err: unknown): never {
  if (err instanceof ApiError) {
    if (err.status === 401) console.error('Not logged in or session expired. Run `forge login`.');
    else if (err.status === 403) console.error('Access denied — check your project role.');
    else console.error(`API error: ${err.message}`);
    process.exit(1);
  }
  if (err instanceof Error) {
    console.error(err.message);
    process.exit(1);
  }
  throw err;
}

// ── forge login ─────────────────────────────────────────────────────────────

export async function cmdLogin(urlFlag?: string): Promise<void> {
  const rawUrl = urlFlag || process.env.SECRETFORGE_URL || 'http://localhost:4000';
  if (rawUrl.startsWith('sf_')) {
    console.error(
      'SECRETFORGE_URL looks like a service token (starts with "sf_").\n' +
        'Service tokens go in SECRETFORGE_TOKEN, not SECRETFORGE_URL.\n' +
        'SECRETFORGE_URL must be the API URL, e.g. https://secretforge-api.onrender.com',
    );
    process.exit(1);
  }
  const apiUrl = rawUrl.replace(/\/+$/, '');

  console.log(`Logging in to ${apiUrl}`);
  const email = await prompt('Email: ');
  if (!email) {
    console.error('Email is required.');
    process.exit(1);
  }
  const password = await promptHidden('Password: ');

  let res = await fetch(`${apiUrl}/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });

  // 2FA: the API refuses to issue tokens until a TOTP code is provided.
  if (res.status === 401) {
    const first = (await res.json().catch(() => null)) as { message?: string; totp_required?: boolean } | null;
    if (first?.totp_required === true) {
      const totpCode = await prompt('Two-factor code: ');
      res = await fetch(`${apiUrl}/auth/login`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email, password, totpCode }),
      });
    } else {
      console.error(first?.message ?? `Login failed (${res.status})`);
      process.exit(1);
    }
  }

  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { message?: string } | null;
    console.error(body?.message ?? `Login failed (${res.status})`);
    process.exit(1);
  }
  const body = (await res.json()) as { accessToken: string; refreshToken: string; user: { email: string } };

  const creds: Credentials = {
    apiUrl,
    email: body.user.email,
    accessToken: body.accessToken,
    refreshToken: body.refreshToken,
  };
  new ApiClient(creds).setCredentials(creds); // persists with chmod 600
  console.log(`Logged in as ${creds.email}.`);
}

// ── forge logout ────────────────────────────────────────────────────────────

export async function cmdLogout(): Promise<void> {
  const client = ApiClient.fromStored();
  if (client.isLoggedIn) {
    try {
      // Best-effort server-side revocation; local clear happens regardless.
      const creds = loadCredentialsForLogout();
      if (creds) {
        await fetch(`${client.apiUrl}/auth/logout`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ refreshToken: creds.refreshToken }),
        });
      }
    } catch {
      /* server unreachable — still clear locally */
    }
  }
  client.logoutLocally();
  console.log('Logged out.');
}

function loadCredentialsForLogout(): Credentials | null {
  // Re-read from disk so logout works even with an expired access token.
  return loadCredentials();
}

// ── forge whoami ────────────────────────────────────────────────────────────

export async function cmdWhoami(): Promise<void> {
  const client = requireClient();
  const me = await client.get<{ email: string; name: string | null }>('/auth/me');
  console.log(`${me.email}${me.name ? ` (${me.name})` : ''}`);
}

// ── forge init ──────────────────────────────────────────────────────────────

export async function cmdInit(projectIdFlag?: string, envFlag?: string, groupFlag?: string): Promise<void> {
  const client = requireClient();

  // Already linked? Confirm before overwriting.
  const existing = findProjectFile();
  if (existing && !projectIdFlag) {
    console.log(`Found existing link: ${existing}`);
    const link = loadProjectLink();
    console.log(`  projectId: ${link.projectId}, defaultEnv: ${link.defaultEnv}`);
    const answer = await prompt('Overwrite? [y/N] ');
    if (answer.toLowerCase() !== 'y') {
      console.log('Aborted.');
      return;
    }
  }

  // List projects the user can access and let them pick.
  const projects = await client.get<
    Array<{ id: string; name: string; slug: string; environments: Array<{ name: string }> }>
  >('/projects');

  if (projects.length === 0) {
    console.error(
      'No projects found. Create one in the web UI, or via:\n' +
        '  curl -X POST <api>/projects -H "Authorization: Bearer <token>" ...',
    );
    process.exit(1);
  }

  let projectId = projectIdFlag;
  let chosen = projects.find((p) => p.id === projectId);
  if (!projectId) {
    console.log('Your projects:');
    projects.forEach((p, i) => console.log(`  ${i + 1}. ${p.name} (${p.slug}) — ${p.id}`));
    const answer = await prompt('Select project [1]: ');
    const idx = answer ? parseInt(answer, 10) - 1 : 0;
    chosen = projects[idx];
    if (!chosen) {
      console.error('Invalid selection.');
      process.exit(1);
    }
    projectId = chosen.id;
  }

  let defaultEnv = envFlag;
  if (!defaultEnv && chosen) {
    const envNames = chosen.environments.map((e) => e.name);
    const answer = await prompt(`Default environment [${envNames[0]}]: `);
    defaultEnv = answer || envNames[0];
  }

  const file = saveProjectLink({
    projectId: projectId!,
    defaultEnv: defaultEnv || 'dev',
    ...(groupFlag ? { group: groupFlag } : {}),
  });
  console.log(
    `Linked project ${projectId} (default env: ${defaultEnv || 'dev'}${groupFlag ? `, group: ${groupFlag}` : ''}).`,
  );
  console.log(`Wrote ${file} — safe to commit (contains only the project ID, default env and group).`);
}

// ── forge set ────────────────────────────────────────────────────────────────

export async function cmdSet(
  kvArg: string,
  envFlag: string | undefined,
  projectFlag: string | undefined,
  groupFlag?: string,
): Promise<void> {
  const parsed = parseSetArg(kvArg);
  if (!parsed) {
    console.error('Usage: forge set KEY=value [--env dev]');
    process.exit(1);
  }

  const client = requireClient();
  const link = projectFlag
    ? ({ projectId: projectFlag, defaultEnv: 'dev' } as ProjectLink)
    : loadProjectLink();
  const env = resolveEnv(envFlag, link);
  const group = resolveGroup(groupFlag, link);

  // Read the value hidden if it wasn't provided inline.
  let value = parsed.value;
  if (value === '') {
    value = await promptHidden(`${parsed.key} value: `);
  }

  try {
    const result = await client.put<{ version: number }>(
      `/projects/${link.projectId}/envs/${env}/secrets/${parsed.key}${groupQuery(group)}`,
      { value },
    );
    console.log(`Set ${parsed.key} in ${env}${group ? ` [${group}]` : ''} (v${result.version}).`);
  } catch (err) {
    fail(err);
  }
}

// ── forge list ──────────────────────────────────────────────────────────────

export async function cmdList(
  envFlag: string | undefined,
  projectFlag: string | undefined,
  groupFlag?: string,
): Promise<void> {
  const client = requireClient();
  const link = projectFlag
    ? ({ projectId: projectFlag, defaultEnv: 'dev' } as ProjectLink)
    : loadProjectLink();
  const env = resolveEnv(envFlag, link);
  const group = resolveGroup(groupFlag, link); // undefined → list every group

  try {
    const result = await client.get<{
      environment: string;
      secrets: Array<{ group: string; key: string; version: number; updatedAt: string }>;
    }>(`/projects/${link.projectId}/envs/${env}/secrets${groupQuery(group)}`);
    if (result.secrets.length === 0) {
      console.log(`No secrets in ${env}${group ? ` [${group}]` : ''}.`);
      return;
    }
    console.log(`Secrets in ${env}${group ? ` [${group}]` : ''} (${result.secrets.length}):`);
    for (const s of result.secrets) {
      const name = !group && s.group ? `${s.group}/${s.key}` : s.key;
      console.log(`  ${name.padEnd(32)} v${s.version}  ${s.updatedAt}`);
    }
  } catch (err) {
    fail(err);
  }
}

// ── forge run ───────────────────────────────────────────────────────────────

/**
 * Fetch decrypted secrets over HTTPS and spawn the command with them merged
 * into its environment. Nothing is written to disk (plan: "replaces .env").
 */
export async function cmdRun(
  command: string[],
  envFlag: string | undefined,
  projectFlag: string | undefined,
  groupFlag?: string,
): Promise<void> {
  if (command.length === 0) {
    console.error('Usage: forge run --env dev -- <command> [args...]');
    process.exit(1);
  }

  const client = requireClient();
  const link = projectFlag
    ? ({ projectId: projectFlag, defaultEnv: 'dev' } as ProjectLink)
    : loadProjectLink();
  const env = resolveEnv(envFlag, link);
  const group = resolveGroup(groupFlag, link);

  let secrets: Record<string, string>;
  try {
    const result = await client.get<{ values: Record<string, string> }>(
      `/projects/${link.projectId}/envs/${env}/secrets/export${groupQuery(group)}`,
    );
    secrets = result.values;
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) {
      console.error(`No secrets found in environment "${env}"${group ? ` (group "${group}")` : ''}.`);
      process.exit(1);
    }
    fail(err);
  }

  const merged = mergeEnv(process.env, secrets);
  const [cmd, ...args] = command;

  const child = spawn(cmd, args, {
    env: merged,
    stdio: 'inherit',
    shell: process.platform === 'win32', // Windows needs shell resolution
  });

  child.on('error', (err) => {
    console.error(`Failed to start ${cmd}: ${err.message}`);
    process.exit(1);
  });

  child.on('exit', (code, signal) => {
    if (signal) process.kill(process.pid, signal);
    else process.exit(code ?? 1);
  });
}

// ── forge pull ───────────────────────────────────────────────────────────────

/**
 * Escape hatch: write secrets to a local .env file. Prints a warning —
 * the whole point of SecretForge is to NOT have this file around.
 */
export async function cmdPull(
  envFlag: string | undefined,
  projectFlag: string | undefined,
  stdoutFlag: boolean,
  groupFlag?: string,
): Promise<void> {
  const client = requireClient();
  const link = projectFlag
    ? ({ projectId: projectFlag, defaultEnv: 'dev' } as ProjectLink)
    : loadProjectLink();
  const env = resolveEnv(envFlag, link);
  const group = resolveGroup(groupFlag, link);

  let values: Record<string, string>;
  try {
    const result = await client.get<{ values: Record<string, string> }>(
      `/projects/${link.projectId}/envs/${env}/secrets/export${groupQuery(group)}`,
    );
    values = result.values;
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) {
      console.error(`No secrets found in environment "${env}"${group ? ` (group "${group}")` : ''}.`);
      process.exit(1);
    }
    fail(err);
  }

  const content = formatEnvFile(values);
  if (stdoutFlag) {
    process.stdout.write(content);
    return;
  }

  writeFileSync('.env', content, { mode: 0o600 });
  console.warn(
    `Wrote .env (${Object.keys(values).length} secrets, chmod 600).\n` +
      `⚠  This file contains PLAINTEXT secrets. Add .env to .gitignore and delete it when done.`,
  );
}

// ── forge import ────────────────────────────────────────────────────────────

/** Push an existing .env file into the vault (migration helper). */
export async function cmdImport(
  fileArg: string | undefined,
  envFlag: string | undefined,
  projectFlag: string | undefined,
  groupFlag?: string,
): Promise<void> {
  const file = fileArg ?? '.env';
  if (!existsSync(file)) {
    console.error(`File not found: ${file}`);
    process.exit(1);
  }

  const content = readFileSync(file, 'utf8');

  const client = requireClient();
  const link = projectFlag
    ? ({ projectId: projectFlag, defaultEnv: 'dev' } as ProjectLink)
    : loadProjectLink();
  const env = resolveEnv(envFlag, link);
  const group = resolveGroup(groupFlag, link);

  try {
    const result = await client.post<{ imported: number; created: number; updated: number; keys: string[] }>(
      `/projects/${link.projectId}/envs/${env}/secrets/import${groupQuery(group)}`,
      { content },
    );
    console.log(
      `Imported ${result.imported} secrets into ${env}${group ? ` [${group}]` : ''} (${result.created} created, ${result.updated} updated).`,
    );
    console.log(`Keys: ${result.keys.join(', ')}`);
    console.log('⚠  Now rotate any secrets previously shared over chat/email.');
  } catch (err) {
    fail(err);
  }
}
