import type { EntityType } from '@prisma/client';
import type {
  CompensateRequest,
  CompensateResult,
  FindKeys,
  FoundEntity,
  PublishRequest,
  PublishResult,
} from '../../src/domain/publish/actions.js';
import type { PublisherPort } from '../../src/ports/publisher.port.js';

/**
 * In-memory PublisherPort for integration tests. Deterministic externalIds
 * keyed by idempotencyKey (so retries are stable, like a real idempotent API),
 * with optional failure injection on the Nth apply call.
 */
export class FakePublisher implements PublisherPort {
  readonly applied: PublishRequest[] = [];
  readonly compensated: CompensateRequest[] = [];
  /** 1-based index of an apply() call that should throw, or null. */
  failOnApplyNumber: number | null = null;

  private applyCount = 0;

  async apply(req: PublishRequest): Promise<PublishResult> {
    this.applyCount++;
    if (this.failOnApplyNumber !== null && this.applyCount === this.failOnApplyNumber) {
      throw new Error(`simulated publish failure on apply #${this.applyCount}`);
    }
    this.applied.push(req);
    const externalId = req.externalId ?? `fake_${req.entityType}_${hash(req.idempotencyKey)}`;
    return { externalId, response: { ok: true } };
  }

  async compensate(req: CompensateRequest): Promise<CompensateResult> {
    this.compensated.push(req);
    return { response: { ok: true } };
  }

  async find(_entityType: EntityType, _keys: FindKeys): Promise<FoundEntity[]> {
    return [];
  }

  async status(): Promise<{ ok: boolean; adapter: string }> {
    return { ok: true, adapter: 'fake' };
  }
}

function hash(s: string): string {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h).toString(16);
}
