import { BatchStatus, Prisma } from '@prisma/client';
import { prisma } from '../infra/db/prisma.js';
import { findIntraBatchDuplicates, type MatchableRecord } from '../domain/match/dedupe.js';

/**
 * Match stage: intra-batch deduplication. Compares canonical records within the
 * batch (exact email/code, fuzzy name), records MatchCandidates, and generates
 * ReviewItems with plain-language explanations for duplicates / low-confidence
 * matches. Leaves VALIDATION_ERROR review items (from normalize) intact.
 * Idempotent. Moves the batch to IN_REVIEW (open items) or READY.
 *
 * External-platform matching is intentionally stubbed/out-of-scope here; it
 * arrives with the publisher adapter (UNI-134).
 */
export async function runMatch(batchId: string): Promise<void> {
  const batch = await prisma.importBatch.findUnique({ where: { id: batchId } });
  if (!batch) return;

  await prisma.importBatch.update({ where: { id: batchId }, data: { status: BatchStatus.MATCHING } });

  // Idempotent rebuild of match outputs; keep normalize's validation reviews.
  await prisma.matchCandidate.deleteMany({ where: { batchId } });
  await prisma.reviewItem.deleteMany({
    where: { batchId, reason: { in: ['DUPLICATE', 'LOW_CONFIDENCE', 'CONFLICT'] } },
  });

  const records = await prisma.canonicalRecord.findMany({
    where: { batchId },
    orderBy: { createdAt: 'asc' },
    select: { id: true, entityType: true, keyEmail: true, keyCode: true, keyName: true },
  });

  const findings = findIntraBatchDuplicates(records as MatchableRecord[]);

  for (const f of findings) {
    await prisma.matchCandidate.create({
      data: {
        batchId,
        canonicalRecordId: f.recordId,
        entityType: f.entityType,
        targetKind: 'INTRA_BATCH',
        targetRecordId: f.peerRecordId,
        score: f.score,
        strategy: f.strategy,
        status: 'CANDIDATE',
        evidence: { explanation: f.explanation } as Prisma.InputJsonValue,
      },
    });

    await prisma.reviewItem.create({
      data: {
        batchId,
        canonicalRecordId: f.recordId,
        entityType: f.entityType,
        reason: f.reason,
        priority: f.reason === 'DUPLICATE' ? 1 : 0,
        details: {
          explanation: f.explanation,
          strategy: f.strategy,
          score: f.score,
          peerRecordId: f.peerRecordId,
        },
      },
    });
  }

  const duplicates = findings.filter((f) => f.reason === 'DUPLICATE').length;
  const lowConfidence = findings.filter((f) => f.reason === 'LOW_CONFIDENCE').length;

  await prisma.importBatch.update({
    where: { id: batchId },
    data: {
      status: BatchStatus.MATCHED,
      counts: {
        ...(batch.counts as object),
        matchCandidates: findings.length,
        duplicates,
        lowConfidence,
      },
    },
  });

  const openReview = await prisma.reviewItem.count({ where: { batchId, status: 'OPEN' } });
  await prisma.importBatch.update({
    where: { id: batchId },
    data: { status: openReview > 0 ? BatchStatus.IN_REVIEW : BatchStatus.READY },
  });
}
