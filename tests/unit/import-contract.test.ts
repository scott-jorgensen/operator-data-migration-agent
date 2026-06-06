import { describe, expect, it } from 'vitest';
import { EntityType, PublishOp } from '@prisma/client';
import {
  ApplyActionRequestSchema,
  ApplyActionResponseSchema,
  CompensateRequestSchema,
  CompensateResponseSchema,
  ENTITY_TYPES,
  ErrorResponseSchema,
  FindResponseSchema,
  HealthResponseSchema,
  IMPORT_API,
  PUBLISH_OPS,
} from '../../src/domain/publish/contract.js';

describe('import API contract', () => {
  it('wire enums stay in sync with the domain enums', () => {
    expect([...ENTITY_TYPES].sort()).toEqual(Object.values(EntityType).sort());
    expect([...PUBLISH_OPS].sort()).toEqual(Object.values(PublishOp).sort());
  });

  it('accepts a valid apply request and rejects a malformed one', () => {
    const ok = ApplyActionRequestSchema.safeParse({
      op: 'CREATE',
      entityType: 'PRODUCT',
      data: { name: 'Kili', sku: 'TZ-KILI-7D' },
      idempotencyKey: 'b:r:CREATE',
    });
    expect(ok.success).toBe(true);

    expect(ApplyActionRequestSchema.safeParse({ op: 'CREATE', entityType: 'PRODUCT' }).success).toBe(false); // no key
    expect(ApplyActionRequestSchema.safeParse({ op: 'NOPE', entityType: 'PRODUCT', idempotencyKey: 'k' }).success).toBe(false);
  });

  it('validates apply/compensate responses including the status literal', () => {
    expect(
      ApplyActionResponseSchema.safeParse({ externalId: 'p1', op: 'CREATE', entityType: 'PRODUCT', status: 'COMMITTED' }).success,
    ).toBe(true);
    expect(
      ApplyActionResponseSchema.safeParse({ externalId: 'p1', op: 'CREATE', entityType: 'PRODUCT', status: 'PENDING' }).success,
    ).toBe(false);
    expect(CompensateResponseSchema.safeParse({ externalId: 'p1', status: 'ROLLED_BACK' }).success).toBe(true);
  });

  it('validates compensate request, find response, health, and error envelope', () => {
    expect(
      CompensateRequestSchema.safeParse({ originalOp: 'CREATE', entityType: 'PRODUCT', externalId: 'p1', idempotencyKey: 'k' }).success,
    ).toBe(true);
    expect(FindResponseSchema.safeParse({ results: [] }).success).toBe(true);
    expect(FindResponseSchema.safeParse({ results: [{ externalId: 't1', data: { email: 'a@b.com' } }] }).success).toBe(true);
    expect(HealthResponseSchema.safeParse({ ok: true, service: 'x' }).success).toBe(true);
    expect(ErrorResponseSchema.safeParse({ error: { code: 'validation_error', message: 'bad' } }).success).toBe(true);
    expect(ErrorResponseSchema.safeParse({ error: { code: 'teapot', message: 'x' } }).success).toBe(false);
  });

  it('exposes the endpoint map', () => {
    expect(IMPORT_API.endpoints.apply).toBe('POST /v1/import/actions');
    expect(IMPORT_API.basePath).toBe('/v1/import');
  });
});
