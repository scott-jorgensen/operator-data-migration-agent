import { createHash } from 'node:crypto';
import type { EntityType } from '@prisma/client';
import type {
  CompensateRequest,
  CompensateResult,
  FindKeys,
  FoundEntity,
  PublishRequest,
  PublishResult,
} from '../../domain/publish/actions.js';
import type { PublisherPort } from '../../ports/publisher.port.js';

/**
 * Stub publisher. Stands in for the operator platform import API until the real
 * HTTP client lands. It does not simulate a platform: `find` returns nothing
 * (matching is intra-batch for the MVP). `apply` returns a deterministic
 * externalId derived from the idempotency key, so retries are stable.
 *
 * It records applied/compensated calls in memory for inspection in tests.
 */
export class OperatorImportStubPublisher implements PublisherPort {
  readonly applied: PublishRequest[] = [];
  readonly compensated: CompensateRequest[] = [];

  async apply(req: PublishRequest): Promise<PublishResult> {
    this.applied.push(req);
    const externalId = req.externalId ?? stableExternalId(req.entityType, req.idempotencyKey);
    return { externalId, response: { stub: true, op: req.op, idempotencyKey: req.idempotencyKey } };
  }

  async compensate(req: CompensateRequest): Promise<CompensateResult> {
    this.compensated.push(req);
    return { response: { stub: true, compensatedOp: req.originalOp, externalId: req.externalId } };
  }

  async find(_entityType: EntityType, _keys: FindKeys): Promise<FoundEntity[]> {
    // No simulated platform — external matching is out of scope for the MVP.
    return [];
  }

  async status(): Promise<{ ok: boolean; adapter: string }> {
    return { ok: true, adapter: 'operator-import-stub' };
  }
}

function stableExternalId(entityType: EntityType, idempotencyKey: string): string {
  const hash = createHash('sha1').update(idempotencyKey).digest('hex').slice(0, 16);
  return `ext_${entityType.toLowerCase()}_${hash}`;
}
