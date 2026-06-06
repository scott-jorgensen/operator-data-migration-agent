import type { EntityType, PublishOp } from '@prisma/client';

/**
 * The explicit, typed publish actions — the entire surface through which this
 * service mutates the operator platform. No other path writes platform data.
 *
 *  - CREATE     : create a new platform entity from canonical data
 *  - UPDATE     : update an existing platform entity (by externalId)
 *  - LINK       : associate a canonical record with an existing entity (no create)
 *  - DEACTIVATE : soft-deactivate an existing entity (used for rollback/compensation)
 */
export interface PublishRequest {
  op: PublishOp;
  entityType: EntityType;
  /** Target platform entity for UPDATE / LINK / DEACTIVATE. */
  externalId?: string | null;
  /** Canonical payload for CREATE / UPDATE / LINK. */
  data?: Record<string, unknown>;
  /** Stable key so retries are safe and the publisher can dedupe. */
  idempotencyKey: string;
}

export interface PublishResult {
  externalId: string;
  response?: unknown;
}

export interface CompensateRequest {
  /** The op being compensated (informs how to reverse it). */
  originalOp: PublishOp;
  entityType: EntityType;
  externalId: string;
  idempotencyKey: string;
}

export interface CompensateResult {
  response?: unknown;
}

/** Lookup keys the publisher can match existing platform entities on. */
export interface FindKeys {
  email?: string;
  code?: string;
  name?: string;
}

export interface FoundEntity {
  externalId: string;
  data: Record<string, unknown>;
}

/** Deterministic idempotency key for a batch/record/op. */
export function idempotencyKey(batchId: string, canonicalRecordId: string, op: PublishOp): string {
  return `${batchId}:${canonicalRecordId}:${op}`;
}
