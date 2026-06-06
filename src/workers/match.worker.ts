import { BatchStatus, Prisma } from '@prisma/client';
import { prisma } from '../infra/db/prisma.js';
import { logger } from '../lib/logger.js';
import { findIntraBatchDuplicates, type MatchableRecord } from '../domain/match/dedupe.js';
import { markFailed, mergeCounts } from './normalize.worker.js';

/**
 * Match stage: intra-batch deduplication. Compares canonical records within the
 * batch (exact email/code, fuzzy name), records MatchCandidates, and generates
 * ReviewItems with plain-language explanations for duplicates / low-confidence
 * matches. Leaves VALIDATION_ERROR review items (from normalize) intact.
 * Idempotent. Moves the batch to IN_REVIEW (open items) or READY. On failure
 * the batch is moved to FAILED with a structured error and the job rethrows.
 *
 * External-platform matching is intentionally stubbed/out-of-scope here; it
 * arrives with the publisher adapter (UNI-134).
 */
export async function runMatch(batchId: string): Promise<void> {
  const log = logger.child({ batchId, stage: 'match' });
  const startedAt = Date.now();
  try {
    const batch = await prisma.importBatch.findUnique({ where: { id: batchId } });
    if (!batch) {
      log.warn('batch not found; skipping');
      return;
    }

    await prisma.importBatch.update({ where: { id: batchId }, data: { status: BatchStatus.MATCHING } });
    log.info('match started');

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
    const durationMs = Date.now() - startedAt;

    await prisma.importBatch.update({
      where: { id: batchId },
      data: {
        status: BatchStatus.MATCHED,
        counts: mergeCounts(batch.counts, {
          matchCandidates: findings.length,
          duplicates,
          lowConfidence,
          timings: { matchMs: durationMs },
        }),
      },
    });

    const openReview = await prisma.reviewItem.count({ where: { batchId, status: 'OPEN' } });
    const finalStatus = openReview > 0 ? BatchStatus.IN_REVIEW : BatchStatus.READY;
    await prisma.importBatch.update({ where: { id: batchId }, data: { status: finalStatus } });
    log.info({ matchCandidates: findings.length, duplicates, lowConfidence, openReview, finalStatus, durationMs }, 'match complete');
  } catch (err) {
    log.error({ err: String(err) }, 'match failed');
    await markFailed(batchId, 'match', err);
    throw err;
  }
}
