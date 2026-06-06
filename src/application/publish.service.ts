import {
  BatchStatus,
  CanonicalStatus,
  type CanonicalRecord,
  type MatchCandidate,
  PublishOp,
  PublishStatus,
  Prisma,
  ReviewStatus,
} from '@prisma/client';
import { prisma } from '../infra/db/prisma.js';
import { idempotencyKey } from '../domain/publish/actions.js';
import type { PublisherPort } from '../ports/publisher.port.js';

export class BatchNotFoundError extends Error {
  constructor(public readonly batchId: string) {
    super(`batch not found: ${batchId}`);
    this.name = 'BatchNotFoundError';
  }
}

export class NotPublishableError extends Error {
  constructor(public readonly batchId: string, public readonly openReviewItems: number) {
    super(`batch ${batchId} has ${openReviewItems} unresolved review item(s)`);
    this.name = 'NotPublishableError';
  }
}

export class InvalidBatchStateError extends Error {
  constructor(public readonly batchId: string, public readonly status: BatchStatus, action: string) {
    super(`batch ${batchId} cannot ${action} from status ${status}`);
    this.name = 'InvalidBatchStateError';
  }
}

type RecordWithMatches = CanonicalRecord & { matchCandidates: MatchCandidate[] };

interface OpDecision {
  op: PublishOp;
  targetExternalId?: string;
}

/**
 * Orchestrates the publish lifecycle: preview (plan typed PublishActions),
 * commit (apply them through the PublisherPort), and rollback (best-effort
 * compensation). PublishAction rows are the durable, idempotent log of
 * everything done — commit resumes from PLANNED/FAILED and skips COMMITTED.
 */
export class PublishService {
  constructor(private readonly publisher: PublisherPort) {}

  /** Compute the plan of typed actions without calling the platform. */
  async preview(batchId: string) {
    const batch = await this.requireBatch(batchId);
    await this.assertNoOpenReviews(batchId);
    assertStatusIn(batch.status, [BatchStatus.READY, BatchStatus.PREVIEWED], 'preview', batchId);

    // Idempotent: rebuild the un-committed plan only.
    await prisma.publishAction.deleteMany({ where: { batchId, status: PublishStatus.PLANNED } });

    const records = await prisma.canonicalRecord.findMany({
      where: { batchId },
      include: { matchCandidates: true },
      orderBy: { createdAt: 'asc' },
    });

    let sequence = 0;
    const actions = [];
    for (const rec of records as RecordWithMatches[]) {
      const decision = decideOp(rec);
      if (!decision) continue; // merged duplicate — represented by its peer
      const action = await prisma.publishAction.create({
        data: {
          batchId,
          canonicalRecordId: rec.id,
          entityType: rec.entityType,
          op: decision.op,
          status: PublishStatus.PLANNED,
          sequence: sequence++,
          payload: (rec.data ?? {}) as Prisma.InputJsonValue,
          targetExternalId: decision.targetExternalId ?? null,
        },
      });
      actions.push(action);
    }

    await prisma.importBatch.update({ where: { id: batchId }, data: { status: BatchStatus.PREVIEWED } });
    return { batchId, status: BatchStatus.PREVIEWED, actions, summary: summarize(actions) };
  }

  /** Execute the planned actions through the publisher. Idempotent/resumable. */
  async commit(batchId: string) {
    const batch = await this.requireBatch(batchId);
    await this.assertNoOpenReviews(batchId);
    assertStatusIn(
      batch.status,
      [
        BatchStatus.READY,
        BatchStatus.PREVIEWED,
        BatchStatus.COMMITTING,
        BatchStatus.COMMITTED, // re-commit is a safe no-op (idempotent)
        BatchStatus.FAILED,
      ],
      'commit',
      batchId,
    );

    // Ensure a plan exists.
    let pending = await prisma.publishAction.findMany({
      where: { batchId, status: { in: [PublishStatus.PLANNED, PublishStatus.FAILED] } },
      orderBy: { sequence: 'asc' },
    });
    if (pending.length === 0) {
      const committed = await prisma.publishAction.count({ where: { batchId, status: PublishStatus.COMMITTED } });
      if (committed === 0) {
        await this.preview(batchId);
        pending = await prisma.publishAction.findMany({
          where: { batchId, status: PublishStatus.PLANNED },
          orderBy: { sequence: 'asc' },
        });
      }
    }

    await prisma.importBatch.update({ where: { id: batchId }, data: { status: BatchStatus.COMMITTING } });

    for (const action of pending) {
      try {
        const result = await this.publisher.apply({
          op: action.op,
          entityType: action.entityType,
          externalId: action.targetExternalId,
          data: (action.payload ?? {}) as Record<string, unknown>,
          idempotencyKey: idempotencyKey(batchId, action.canonicalRecordId, action.op),
        });
        await prisma.$transaction([
          prisma.publishAction.update({
            where: { id: action.id },
            data: {
              status: PublishStatus.COMMITTED,
              resultExternalId: result.externalId,
              response: (result.response ?? undefined) as Prisma.InputJsonValue | undefined,
              error: Prisma.DbNull,
            },
          }),
          prisma.canonicalRecord.update({
            where: { id: action.canonicalRecordId },
            data: { status: CanonicalStatus.PUBLISHED, externalId: result.externalId },
          }),
        ]);
      } catch (err) {
        await prisma.publishAction.update({
          where: { id: action.id },
          data: { status: PublishStatus.FAILED, error: { message: String(err) } },
        });
        await prisma.importBatch.update({
          where: { id: batchId },
          data: { status: BatchStatus.FAILED, error: { stage: 'commit', actionId: action.id, message: String(err) } },
        });
        throw err;
      }
    }

    await prisma.importBatch.update({ where: { id: batchId }, data: { status: BatchStatus.COMMITTED, error: Prisma.DbNull } });
    const all = await prisma.publishAction.findMany({ where: { batchId } });
    return { batchId, status: BatchStatus.COMMITTED, summary: summarize(all) };
  }

  /** Best-effort compensation for a committed batch (pragmatic, not perfect). */
  async rollback(batchId: string) {
    const batch = await this.requireBatch(batchId);
    assertStatusIn(
      batch.status,
      [BatchStatus.COMMITTED, BatchStatus.FAILED, BatchStatus.ROLLING_BACK],
      'rollback',
      batchId,
    );

    const committed = await prisma.publishAction.findMany({
      where: { batchId, status: PublishStatus.COMMITTED },
      orderBy: { sequence: 'desc' },
    });

    await prisma.importBatch.update({ where: { id: batchId }, data: { status: BatchStatus.ROLLING_BACK } });

    let compensations = 0;
    for (const action of committed) {
      if (!action.resultExternalId) continue;
      const result = await this.publisher.compensate({
        originalOp: action.op,
        entityType: action.entityType,
        externalId: action.resultExternalId,
        idempotencyKey: idempotencyKey(batchId, action.canonicalRecordId, PublishOp.DEACTIVATE),
      });
      await prisma.$transaction([
        prisma.publishAction.create({
          data: {
            batchId,
            canonicalRecordId: action.canonicalRecordId,
            entityType: action.entityType,
            op: PublishOp.DEACTIVATE,
            status: PublishStatus.ROLLED_BACK,
            sequence: action.sequence,
            payload: {},
            targetExternalId: action.resultExternalId,
            response: (result.response ?? undefined) as Prisma.InputJsonValue | undefined,
            compensationOf: action.id,
          },
        }),
        prisma.publishAction.update({ where: { id: action.id }, data: { status: PublishStatus.ROLLED_BACK } }),
        prisma.canonicalRecord.update({
          where: { id: action.canonicalRecordId },
          data: { status: CanonicalStatus.REVIEWED, externalId: null },
        }),
      ]);
      compensations++;
    }

    await prisma.importBatch.update({ where: { id: batchId }, data: { status: BatchStatus.ROLLED_BACK } });
    return { batchId, status: BatchStatus.ROLLED_BACK, compensations };
  }

  listActions(batchId: string) {
    return prisma.publishAction.findMany({ where: { batchId }, orderBy: [{ sequence: 'asc' }, { createdAt: 'asc' }] });
  }

  private async requireBatch(batchId: string) {
    const batch = await prisma.importBatch.findUnique({ where: { id: batchId } });
    if (!batch) throw new BatchNotFoundError(batchId);
    return batch;
  }

  private async assertNoOpenReviews(batchId: string): Promise<void> {
    const open = await prisma.reviewItem.count({ where: { batchId, status: ReviewStatus.OPEN } });
    if (open > 0) throw new NotPublishableError(batchId, open);
  }
}

/** Decide the publish op for a canonical record, or null to suppress it. */
function decideOp(rec: RecordWithMatches): OpDecision | null {
  const confirmed = rec.matchCandidates.find((m) => m.status === 'CONFIRMED');
  if (confirmed) {
    // Confirmed duplicate of another row in this batch — its peer is published.
    if (confirmed.targetKind === 'INTRA_BATCH') return null;
    // Confirmed match to an existing platform entity — update it in place.
    if (confirmed.targetExternalId) return { op: PublishOp.UPDATE, targetExternalId: confirmed.targetExternalId };
  }
  return { op: PublishOp.CREATE };
}

function summarize(actions: Array<{ op: PublishOp; status: PublishStatus }>) {
  const byOp: Partial<Record<PublishOp, number>> = {};
  const byStatus: Partial<Record<PublishStatus, number>> = {};
  for (const a of actions) {
    byOp[a.op] = (byOp[a.op] ?? 0) + 1;
    byStatus[a.status] = (byStatus[a.status] ?? 0) + 1;
  }
  return { total: actions.length, byOp, byStatus };
}

function assertStatusIn(
  status: BatchStatus,
  allowed: BatchStatus[],
  action: string,
  batchId: string,
): void {
  if (!allowed.includes(status)) throw new InvalidBatchStateError(batchId, status, action);
}
