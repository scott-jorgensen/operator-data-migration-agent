import { z } from 'zod';

/**
 * Single, Zod-validated source of truth for environment configuration.
 * Fail fast at boot if anything required is missing or malformed.
 */
const EnvSchema = z.object({
  NODE_ENV: z
    .enum(['development', 'test', 'production'])
    .default('development'),

  DATABASE_URL: z.string().url(),

  PORT: z.coerce.number().int().positive().default(3001),
  HOST: z.string().default('0.0.0.0'),

  LOG_LEVEL: z
    .enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal'])
    .default('info'),

  ARTIFACT_DIR: z.string().default('./.artifacts'),

  PGBOSS_SCHEMA: z.string().default('pgboss'),

  // Shared secret for service-to-service auth. Callers present it as
  // `Authorization: Bearer <token>`. Required (min length enforced) so we never
  // boot an unauthenticated service by accident.
  SERVICE_AUTH_TOKEN: z.string().min(16, 'must be at least 16 characters'),

  // Which PublisherPort implementation to use. `stub` (default) records actions
  // in-memory; `http` calls the real operator platform import API.
  PUBLISHER: z.enum(['stub', 'http']).default('stub'),
  OPERATOR_IMPORT_BASE_URL: z.string().url().optional(),
  OPERATOR_IMPORT_TOKEN: z.string().optional(),
  OPERATOR_IMPORT_TIMEOUT_MS: z.coerce.number().int().positive().default(10_000),

  // AI column-mapping suggester. When ANTHROPIC_API_KEY is set the LLM mapper is
  // used; otherwise the deterministic alias-based fallback.
  ANTHROPIC_API_KEY: z.string().optional(),
  AI_MAPPING_MODEL: z.string().default('claude-opus-4-8'),
});

export type Env = z.infer<typeof EnvSchema>;

function loadEnv(): Env {
  const parsed = EnvSchema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  return parsed.data;
}

export const env = loadEnv();

export const isProd = env.NODE_ENV === 'production';
export const isTest = env.NODE_ENV === 'test';
