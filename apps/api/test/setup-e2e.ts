import 'reflect-metadata';
import * as dotenv from 'dotenv';
import { resolve } from 'path';

// E2E tests run against a real Postgres (docker compose up -d postgres).
// Load the repo .env first, then apply test overrides. Paths are resolved
// relative to this file so the suite works from any invocation directory.
dotenv.config({ path: resolve(__dirname, '../../../.env') });
dotenv.config({ path: resolve(__dirname, '../.env.e2e'), override: true });

process.env.NODE_ENV = process.env.NODE_ENV ?? 'test';

// Fail fast if the environment isn't configured — a secrets vault must not
// silently boot with missing keys.
for (const key of ['DATABASE_URL', 'SECRETFORGE_MASTER_KEY', 'JWT_SECRET']) {
  if (!process.env[key]) {
    throw new Error(`Missing ${key} for e2e tests. Copy .env.example to .env and fill it in.`);
  }
}
