import type { JobQueue } from '../../src/ports/job-queue.port.js';
import { runNormalize } from '../../src/workers/normalize.worker.js';
import { runMatch } from '../../src/workers/match.worker.js';

/**
 * Test double for the JobQueue that runs the pipeline stages inline and
 * synchronously, so an ingest call drives normalize -> match to completion
 * without standing up pg-boss. Mirrors the worker wiring in production.
 */
export class SyncJobQueue implements JobQueue {
  async enqueueNormalize(batchId: string): Promise<void> {
    await runNormalize(batchId, this);
  }

  async enqueueMatch(batchId: string): Promise<void> {
    await runMatch(batchId);
  }
}
