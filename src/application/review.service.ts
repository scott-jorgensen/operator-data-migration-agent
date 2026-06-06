import {
  BatchStatus,
  CanonicalStatus,
  type EntityType,
  MatchStatus,
  Prisma,
  type ReviewItem,
  type ReviewReason,
  ReviewResolution,
  ReviewStatus,
} from '@prisma/client';
import { prisma } from '../infra/db/prisma.js';
import { CANONICAL_SCHEMAS } from '../domain/canonical/schemas.js';
import { deriveKeys } from '../domain/canonical/normalize.js';

export class ReviewItemNotFoundError extends Error {
  constructor(public readonly id: string) {
    super(`review item not found: ${id}`);
    this.name = 'ReviewItemNotFoundError';
  }
}

export class ReviewItemNotOpenError extends Error {
  constructor(public readonly id: string, public readonly status: ReviewStatus) {
    super(`review item ${id} is not open (status: ${status})`);
    this.name = 'ReviewItemNotOpenError';
  }
}

export interface ListFilters {
  status?: ReviewStatus;
  reason?: ReviewReason;
  entityType?: EntityType;
}

export interface ResolveInput {
  resolution: ReviewResolution;
  resolvedBy?: string;
  resolutionData?: Record<string, unknown>;
}

export interface Readiness {
  batchId: string;
  status: BatchStatus;
  openReviewItems: number;
  openByReason: Partial<Record<ReviewReason, number>>;
  ready: boolean;
}

/**
 * Lists and resolves review items, records an audit event per decision, and
 * keeps the batch's IN_REVIEW/READY status in sync. A batch is publishable only
 * when it has zero open review items (enforced here and re-checked at publish).
 */
export class ReviewService {
  list(batchId: string, filters: ListFilters = {}): Promise<ReviewItem[]> {
    return prisma.reviewItem.findMany({
      where: {
        batchId,
        status: filters.status,
        reason: filters.reason,
        entityType: filters.entityType,
      },
      orderBy: [{ priority: 'desc' }, { createdAt: 'asc' }],
    });
  }

  get(id: string) {
    return prisma.reviewItem.findUnique({ where: { id }, include: { events: true } });
  }

  async resolve(id: string, input: ResolveInput) {
    const item = await prisma.reviewItem.findUnique({
      where: { id },
      include: { canonicalRecord: true },
    });
    if (!item) throw new ReviewItemNotFoundError(id);
    if (item.status !== ReviewStatus.OPEN) throw new ReviewItemNotOpenError(id, item.status);

    await prisma.$transaction(async (tx) => {
      // 1. Apply the canonical-record effect of the decision.
      if (input.resolution === ReviewResolution.EDIT) {
        const fields = (input.resolutionData?.fields ?? {}) as Record<string, unknown>;
        const merged = { ...(item.canonicalRecord.data as Record<string, unknown>), ...fields };
        const parsed = CANONICAL_SCHEMAS[item.entityType].safeParse(merged);
        const data = (parsed.success ? parsed.data : merged) as Record<string, unknown>;
        const keys = deriveKeys(item.entityType, data);
        await tx.canonicalRecord.update({
          where: { id: item.canonicalRecordId },
          data: {
            data: data as Prisma.InputJsonValue,
            dedupeKey: keys.dedupeKey,
            keyEmail: keys.keyEmail,
            keyCode: keys.keyCode,
            keyName: keys.keyName,
            keyDate: keys.keyDate,
            status: CanonicalStatus.REVIEWED,
          },
        });
      } else {
        await tx.canonicalRecord.update({
          where: { id: item.canonicalRecordId },
          data: { status: CanonicalStatus.REVIEWED },
        });
      }

      // 2. Reflect the decision on related match candidate(s).
      const matchStatus = matchStatusFor(input.resolution);
      if (matchStatus) {
        await tx.matchCandidate.updateMany({
          where: { canonicalRecordId: item.canonicalRecordId },
          data: {
            status: matchStatus,
            targetRecordId:
              input.resolution === ReviewResolution.REMAP
                ? (input.resolutionData?.targetRecordId as string | undefined)
                : undefined,
            targetExternalId:
              input.resolution === ReviewResolution.REMAP
                ? (input.resolutionData?.targetExternalId as string | undefined)
                : undefined,
          },
        });
      }

      // 3. Resolve the item.
      await tx.reviewItem.update({
        where: { id },
        data: {
          status: ReviewStatus.RESOLVED,
          resolution: input.resolution,
          resolvedBy: input.resolvedBy ?? null,
          resolutionData: (input.resolutionData ?? undefined) as Prisma.InputJsonValue | undefined,
        },
      });

      // 4. Append an immutable audit event.
      await tx.reviewEvent.create({
        data: {
          reviewItemId: id,
          batchId: item.batchId,
          action: input.resolution,
          fromStatus: ReviewStatus.OPEN,
          toStatus: ReviewStatus.RESOLVED,
          actor: input.resolvedBy ?? null,
          data: (input.resolutionData ?? undefined) as Prisma.InputJsonValue | undefined,
        },
      });
    });

    await this.recomputeBatchStatus(item.batchId);
    return this.get(id);
  }

  async readiness(batchId: string): Promise<Readiness | null> {
    const batch = await prisma.importBatch.findUnique({ where: { id: batchId } });
    if (!batch) return null;

    const grouped = await prisma.reviewItem.groupBy({
      by: ['reason'],
      where: { batchId, status: ReviewStatus.OPEN },
      _count: true,
    });
    const openByReason: Partial<Record<ReviewReason, number>> = {};
    let openTotal = 0;
    for (const g of grouped) {
      openByReason[g.reason] = g._count;
      openTotal += g._count;
    }

    return {
      batchId,
      status: batch.status,
      openReviewItems: openTotal,
      openByReason,
      ready: openTotal === 0,
    };
  }

  /** Keep IN_REVIEW/READY consistent with remaining open items. */
  private async recomputeBatchStatus(batchId: string): Promise<void> {
    const open = await prisma.reviewItem.count({ where: { batchId, status: ReviewStatus.OPEN } });
    const batch = await prisma.importBatch.findUnique({ where: { id: batchId } });
    if (!batch) return;
    if (open === 0 && batch.status === BatchStatus.IN_REVIEW) {
      await prisma.importBatch.update({ where: { id: batchId }, data: { status: BatchStatus.READY } });
    } else if (open > 0 && batch.status === BatchStatus.READY) {
      await prisma.importBatch.update({ where: { id: batchId }, data: { status: BatchStatus.IN_REVIEW } });
    }
  }
}

function matchStatusFor(resolution: ReviewResolution): MatchStatus | null {
  switch (resolution) {
    case ReviewResolution.ACCEPT:
    case ReviewResolution.MERGE:
    case ReviewResolution.REMAP:
      return MatchStatus.CONFIRMED;
    case ReviewResolution.REJECT:
      return MatchStatus.REJECTED;
    case ReviewResolution.EDIT:
      return null;
  }
}
