import { BatchStatus, Prisma } from '@prisma/client';
import { prisma } from '../infra/db/prisma.js';
import { logger } from '../lib/logger.js';
import type { JobQueue } from '../ports/job-queue.port.js';
import { BatchNotFoundError } from './publish.service.js';

/**
 * Pipeline recovery. Re-runs the normalize -> match stages for a batch that
 * failed (or got stuck) during processing. Normalize is an idempotent rebuild,
 * so retry is safe. Commit failures are recovered by re-calling commit (which
 * resumes), not by this.
 */
export class PipelineService {
  constructor(private readonly queue: JobQueue) {}

  async retry(batchId: string): Promise<{ batchId: string; status: BatchStatus }> {
    const batch = await prisma.importBatch.findUnique({ where: { id: batchId } });
    if (!batch) throw new BatchNotFoundError(batchId);

    await prisma.importBatch.update({
      where: { id: batchId },
      data: { status: BatchStatus.EXTRACTED, error: Prisma.DbNull },
    });
    logger.info({ batchId, from: batch.status }, 'retrying pipeline from extract');
    await this.queue.enqueueNormalize(batchId);
    return { batchId, status: BatchStatus.EXTRACTED };
  }
}
