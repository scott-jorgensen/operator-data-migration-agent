import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { EntityType, PublishOp } from '@prisma/client';
import { OperatorImportHttpPublisher, OperatorImportError } from '../../src/infra/publishers/operator-import.http.js';
import { idempotencyKey } from '../../src/domain/publish/actions.js';
import { publisherContract } from '../support/publisher-contract.js';
import { startMockImportServer, type MockImportServer } from '../support/mock-import-server.js';

/**
 * Exercises the real HTTP publisher over actual HTTP against an in-process mock
 * of the import API contract. Runs the shared PublisherPort contract suite plus
 * HTTP-specific behaviors (idempotency, error mapping, find).
 */
let server: MockImportServer;
const client = () => new OperatorImportHttpPublisher({ baseUrl: server.baseUrl, token: 't', timeoutMs: 5000 });

beforeAll(async () => {
  server = await startMockImportServer({
    entities: [{ externalId: 'trav_seed', data: { email: 'seed@example.com' } }],
  });
});
afterAll(async () => {
  await server.close();
});

// The HTTP publisher must satisfy the same contract as the stub.
publisherContract('OperatorImportHttpPublisher', () => client());

describe('OperatorImportHttpPublisher behaviors', () => {
  it('round-trips an apply over HTTP and returns the platform externalId', async () => {
    const res = await client().apply({
      op: PublishOp.CREATE,
      entityType: EntityType.PRODUCT,
      data: { name: 'Kili' },
      idempotencyKey: idempotencyKey('b', 'r1', PublishOp.CREATE),
    });
    expect(res.externalId).toMatch(/^ext_product_/);
  });

  it('maps a contract error envelope to OperatorImportError', async () => {
    const err = await client()
      .apply({
        op: PublishOp.CREATE,
        entityType: EntityType.PRODUCT,
        data: { __fail: true },
        idempotencyKey: idempotencyKey('b', 'r2', PublishOp.CREATE),
      })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(OperatorImportError);
    expect(err).toMatchObject({ code: 'validation_error', status: 422 });
  });

  it('find returns seeded entities from the platform', async () => {
    const found = await client().find(EntityType.TRAVELER, { email: 'seed@example.com' });
    expect(found).toEqual([{ externalId: 'trav_seed', data: { email: 'seed@example.com' } }]);
  });

  it('compensate posts to the platform and records the call', async () => {
    await client().compensate({
      originalOp: PublishOp.CREATE,
      entityType: EntityType.PRODUCT,
      externalId: 'ext_product_1',
      idempotencyKey: idempotencyKey('b', 'r1', PublishOp.DEACTIVATE),
    });
    expect(server.compensated.length).toBeGreaterThan(0);
  });

  it('reports ok status against a healthy platform', async () => {
    expect(await client().status()).toEqual({ ok: true, adapter: 'operator-import-http' });
  });

  it('reports not-ok status when the platform is unreachable', async () => {
    const dead = new OperatorImportHttpPublisher({ baseUrl: 'http://127.0.0.1:1', token: 't', timeoutMs: 500 });
    expect(await dead.status()).toEqual({ ok: false, adapter: 'operator-import-http' });
  });
});
