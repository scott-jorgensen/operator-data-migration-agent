import { describe, expect, it } from 'vitest';
import { EntityType, PublishOp } from '@prisma/client';
import { idempotencyKey } from '../../src/domain/publish/actions.js';
import type { PublisherPort } from '../../src/ports/publisher.port.js';

/**
 * Reusable contract every PublisherPort implementation must satisfy. The stub
 * and (later) the real operator-import client both run this suite, so the
 * migration service's expectations of the platform are pinned in one place.
 */
export function publisherContract(name: string, makePublisher: () => PublisherPort): void {
  describe(`PublisherPort contract: ${name}`, () => {
    it('apply returns a non-empty externalId', async () => {
      const pub = makePublisher();
      const res = await pub.apply({
        op: PublishOp.CREATE,
        entityType: EntityType.PRODUCT,
        data: { name: 'X' },
        idempotencyKey: idempotencyKey('b', 'r', PublishOp.CREATE),
      });
      expect(res.externalId).toBeTruthy();
    });

    it('is idempotent: same key -> same externalId', async () => {
      const pub = makePublisher();
      const key = idempotencyKey('b', 'r', PublishOp.CREATE);
      const a = await pub.apply({ op: PublishOp.CREATE, entityType: EntityType.PRODUCT, data: {}, idempotencyKey: key });
      const b = await pub.apply({ op: PublishOp.CREATE, entityType: EntityType.PRODUCT, data: {}, idempotencyKey: key });
      expect(a.externalId).toBe(b.externalId);
    });

    it('honors a provided externalId for UPDATE/LINK/DEACTIVATE', async () => {
      const pub = makePublisher();
      const res = await pub.apply({
        op: PublishOp.UPDATE,
        entityType: EntityType.TRAVELER,
        externalId: 'ext_known_1',
        data: {},
        idempotencyKey: idempotencyKey('b', 'r', PublishOp.UPDATE),
      });
      expect(res.externalId).toBe('ext_known_1');
    });

    it('compensate resolves for a committed externalId', async () => {
      const pub = makePublisher();
      await expect(
        pub.compensate({
          originalOp: PublishOp.CREATE,
          entityType: EntityType.PRODUCT,
          externalId: 'ext_x',
          idempotencyKey: idempotencyKey('b', 'r', PublishOp.DEACTIVATE),
        }),
      ).resolves.toBeDefined();
    });

    it('status reports ok with an adapter name', async () => {
      const status = await makePublisher().status();
      expect(status.ok).toBe(true);
      expect(status.adapter).toBeTruthy();
    });
  });
}
