import type { EntityType } from '@prisma/client';
import type {
  CompensateRequest,
  CompensateResult,
  FindKeys,
  FoundEntity,
  PublishRequest,
  PublishResult,
} from '../domain/publish/actions.js';

/**
 * The boundary to the operator platform's import API. Implemented by a stub for
 * the MVP and, later, a real HTTP client (UNI-134 follow-up). Keeping this
 * narrow and typed is what keeps the migration service loosely coupled — there
 * is no other way to read or write platform data.
 */
export interface PublisherPort {
  /** Execute one publish action; returns the platform externalId. */
  apply(req: PublishRequest): Promise<PublishResult>;

  /** Reverse a previously committed action (best-effort compensation). */
  compensate(req: CompensateRequest): Promise<CompensateResult>;

  /** Look up existing platform entities for matching (stubbed for MVP). */
  find(entityType: EntityType, keys: FindKeys): Promise<FoundEntity[]>;

  /** Connectivity/health check against the platform import API. */
  status(): Promise<{ ok: boolean; adapter: string }>;
}
