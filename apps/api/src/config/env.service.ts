import { Injectable } from '@nestjs/common';
import { z } from 'zod';

/**
 * Validated, typed environment configuration.
 * The process refuses to boot if required secrets are missing or malformed —
 * fail fast beats running a secrets vault with a weak/absent master key.
 */
const EnvSchema = z.object({
  DATABASE_URL: z.string().min(1),
  SECRETFORGE_MASTER_KEY: z.string().min(1),
  PORT: z.coerce.number().int().positive().default(4000),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 chars (openssl rand -hex 32)'),
  ACCESS_TOKEN_TTL: z.string().default('15m'),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().positive().default(30),
  WEB_ORIGIN: z.string().default('http://localhost:3000'),
});

export type Env = z.infer<typeof EnvSchema>;

@Injectable()
export class EnvService {
  readonly env: Env;

  constructor() {
    const parsed = EnvSchema.safeParse(process.env);
    if (!parsed.success) {
      const issues = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
      throw new Error(`Invalid environment configuration:\n${issues}`);
    }
    this.env = parsed.data;
  }

  get databaseUrl(): string {
    return this.env.DATABASE_URL;
  }
  get masterKey(): string {
    return this.env.SECRETFORGE_MASTER_KEY;
  }
  get port(): number {
    return this.env.PORT;
  }
  get nodeEnv(): string {
    return this.env.NODE_ENV;
  }
  get jwtSecret(): string {
    return this.env.JWT_SECRET;
  }
  get accessTokenTtl(): string {
    return this.env.ACCESS_TOKEN_TTL;
  }
  get refreshTokenTtlDays(): number {
    return this.env.REFRESH_TOKEN_TTL_DAYS;
  }
  get webOrigin(): string {
    return this.env.WEB_ORIGIN;
  }
}
