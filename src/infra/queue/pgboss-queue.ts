import type { JobQueue } from '../../ports/job-queue.port.js';
import { getBoss } from './boss.js';
import { JOBS, type MatchPayload, type NormalizePayload } from './jobs.js';

export class PgBossJobQueue implements JobQueue {
  async enqueueNormalize(batchId: string): Promise<void> {
    await getBoss().send(JOBS.NORMALIZE, { batchId } satisfies NormalizePayload);
  }

  async enqueueMatch(batchId: string): Promise<void> {
    await getBoss().send(JOBS.MATCH, { batchId } satisfies MatchPayload);
  }
}
