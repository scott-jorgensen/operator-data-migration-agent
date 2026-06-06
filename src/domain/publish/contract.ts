import { z } from 'zod';

/**
 * The Operator Import API contract — the wire format between the migration
 * service (client, via PublisherPort) and the operator platform (server,
 * UNI-135). Kept self-contained (literal enums, no Prisma import) so it can be
 * shared verbatim with the platform team and used to validate both sides.
 *
 * See docs/operator-import-api.md and openapi.yaml for the prose + OpenAPI form.
 */

export const ENTITY_TYPES = [
  'PRODUCT',
  'BOOKING',
  'TRAVELER',
  'GUIDE',
  'QUALIFICATION',
  'STAFFING_RULE',
] as const;
export const EntityTypeSchema = z.enum(ENTITY_TYPES);

export const PUBLISH_OPS = ['CREATE', 'UPDATE', 'LINK', 'DEACTIVATE'] as const;
export const PublishOpSchema = z.enum(PUBLISH_OPS);

/** API version + endpoint paths the platform must expose. */
export const IMPORT_API = {
  basePath: '/v1/import',
  endpoints: {
    apply: 'POST /v1/import/actions',
    compensate: 'POST /v1/import/actions/compensate',
    find: 'GET /v1/import/entities',
    health: 'GET /v1/import/health',
  },
} as const;

/** Header carrying the idempotency key (also echoed in the body). */
export const IDEMPOTENCY_HEADER = 'Idempotency-Key';

// --- Requests -------------------------------------------------------------

export const ApplyActionRequestSchema = z.object({
  op: PublishOpSchema,
  entityType: EntityTypeSchema,
  /** Target platform entity for UPDATE / LINK / DEACTIVATE. */
  externalId: z.string().min(1).nullish(),
  /** Canonical payload for CREATE / UPDATE / LINK. */
  data: z.record(z.unknown()).optional(),
  /** Stable key so retries are safe and the platform can dedupe. */
  idempotencyKey: z.string().min(1),
});
export type ApplyActionRequest = z.infer<typeof ApplyActionRequestSchema>;

export const CompensateRequestSchema = z.object({
  /** The op being reversed (informs how to compensate). */
  originalOp: PublishOpSchema,
  entityType: EntityTypeSchema,
  externalId: z.string().min(1),
  idempotencyKey: z.string().min(1),
});
export type CompensateRequest = z.infer<typeof CompensateRequestSchema>;

export const FindQuerySchema = z.object({
  type: EntityTypeSchema,
  email: z.string().optional(),
  code: z.string().optional(),
  name: z.string().optional(),
});
export type FindQuery = z.infer<typeof FindQuerySchema>;

// --- Responses ------------------------------------------------------------

export const ApplyActionResponseSchema = z.object({
  externalId: z.string().min(1),
  op: PublishOpSchema,
  entityType: EntityTypeSchema,
  status: z.literal('COMMITTED'),
  /** Whether the platform deduped this against a prior idempotency key. */
  idempotent: z.boolean().optional(),
  response: z.record(z.unknown()).optional(),
});
export type ApplyActionResponse = z.infer<typeof ApplyActionResponseSchema>;

export const CompensateResponseSchema = z.object({
  externalId: z.string().min(1),
  status: z.literal('ROLLED_BACK'),
  response: z.record(z.unknown()).optional(),
});
export type CompensateResponse = z.infer<typeof CompensateResponseSchema>;

export const FoundEntitySchema = z.object({
  externalId: z.string().min(1),
  data: z.record(z.unknown()),
});
export const FindResponseSchema = z.object({
  results: z.array(FoundEntitySchema),
});
export type FindResponse = z.infer<typeof FindResponseSchema>;

export const HealthResponseSchema = z.object({
  ok: z.boolean(),
  service: z.string().optional(),
});
export type HealthResponse = z.infer<typeof HealthResponseSchema>;

// --- Errors ---------------------------------------------------------------

export const IMPORT_ERROR_CODES = [
  'invalid_request',
  'unauthorized',
  'not_found',
  'conflict',
  'validation_error',
  'internal',
] as const;
export const ImportErrorCodeSchema = z.enum(IMPORT_ERROR_CODES);

export const ErrorResponseSchema = z.object({
  error: z.object({
    code: ImportErrorCodeSchema,
    message: z.string(),
    details: z.record(z.unknown()).optional(),
  }),
});
export type ErrorResponse = z.infer<typeof ErrorResponseSchema>;

/** HTTP status conventions for each error code (informational). */
export const ERROR_STATUS: Record<(typeof IMPORT_ERROR_CODES)[number], number> = {
  invalid_request: 400,
  unauthorized: 401,
  not_found: 404,
  conflict: 409,
  validation_error: 422,
  internal: 500,
};
