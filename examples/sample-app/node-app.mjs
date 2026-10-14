#!/usr/bin/env node
/**
 * SecretForge Node SDK sample.
 *
 * Loads vault secrets into process.env at boot, then prints one.
 * Requires: SECRETFORGE_TOKEN (service token) + .secretforge.json (forge init).
 */
import { config, load } from '@gtools-spaces/sdk';

async function main() {
  // Side-effect version: merges vault secrets into process.env.
  // Real environment variables always win over the vault.
  await config();

  const key = 'SAMPLE_API_KEY';
  const value = process.env[key];

  if (!value) {
    console.error(`✗ ${key} not found — did you run \`forge set ${key}=... --env dev\`?`);
    process.exit(1);
  }

  console.log('Node SDK loaded secrets into process.env');
  console.log(`${key} = ${value}`);

  // No-side-effect alternative: load() returns a plain object.
  const all = await load();
  console.log(`(load() returned ${Object.keys(all).length} secret(s) without touching process.env)`);
}

main().catch((err) => {
  console.error('✗ Failed:', err instanceof Error ? err.message : err);
  process.exit(1);
});