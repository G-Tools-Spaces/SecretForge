import 'reflect-metadata';
import * as dotenv from 'dotenv';

// E2E tests run against a real Postgres (docker compose up -d postgres).
// Load the repo .env first, then apply test overrides.
dotenv.config({ path: '.env' });
dotenv.config({ path: 'apps/api/.env.e2e', override: true });

process.env.NODE_ENV = process.env.NODE_ENV ?? 'test';

// Fail fast if the environment isn't configured — a secrets vault must not
// silently boot with missing keys.
for (const key of ['DATABASE_URL', 'SECRETFORGE_MASTER_KEY', 'JWT_SECRET']) {
  if (!process.env[key]) {
    throw new Error(`Missing ${key} for e2e tests. Copy .env.example to .env and fill it in.`);
  }
}
