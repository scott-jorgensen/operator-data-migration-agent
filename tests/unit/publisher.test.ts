import { describe, expect, it } from 'vitest';
import { EntityType, PublishOp } from '@prisma/client';
import { OperatorImportStubPublisher } from '../../src/infra/publishers/operator-import.stub.js';
import { idempotencyKey } from '../../src/domain/publish/actions.js';

describe('OperatorImportStubPublisher', () => {
  it('returns a deterministic externalId for the same idempotency key', async () => {
    const pub = new OperatorImportStubPublisher();
    const key = idempotencyKey('batch1', 'rec1', PublishOp.CREATE);
    const a = await pub.apply({ op: PublishOp.CREATE, entityType: EntityType.PRODUCT, data: {}, idempotencyKey: key });
    const b = await pub.apply({ op: PublishOp.CREATE, entityType: EntityType.PRODUCT, data: {}, idempotencyKey: key });
    expect(a.externalId).toBe(b.externalId);
    expect(a.externalId).toMatch(/^ext_product_/);
    expect(pub.applied).toHaveLength(2);
  });

  it('honors a provided externalId for UPDATE', async () => {
    const pub = new OperatorImportStubPublisher();
    const res = await pub.apply({
      op: PublishOp.UPDATE,
      entityType: EntityType.TRAVELER,
      externalId: 'ext_existing_123',
      data: { email: 'x@y.com' },
      idempotencyKey: idempotencyKey('b', 'r', PublishOp.UPDATE),
    });
    expect(res.externalId).toBe('ext_existing_123');
  });

  it('find returns nothing (no simulated platform) and status is ok', async () => {
    const pub = new OperatorImportStubPublisher();
    expect(await pub.find(EntityType.TRAVELER, { email: 'a@b.com' })).toEqual([]);
    expect(await pub.status()).toMatchObject({ ok: true, adapter: 'operator-import-stub' });
  });

  it('records compensation calls', async () => {
    const pub = new OperatorImportStubPublisher();
    await pub.compensate({
      originalOp: PublishOp.CREATE,
      entityType: EntityType.PRODUCT,
      externalId: 'ext_product_abc',
      idempotencyKey: 'k',
    });
    expect(pub.compensated).toHaveLength(1);
    expect(pub.compensated[0]?.externalId).toBe('ext_product_abc');
  });
});
