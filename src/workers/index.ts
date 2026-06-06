import { getBoss } from '../infra/queue/boss.js';
import { JOBS, type MatchPayload, type NormalizePayload } from '../infra/queue/jobs.js';
import { jobQueue } from '../application/container.js';
import { runNormalize } from './normalize.worker.js';
import { runMatch } from './match.worker.js';

/**
 * Register pg-boss handlers for the pipeline stages. pg-boss delivers jobs in
 * batches; we process them sequentially. Called only in --worker mode.
 */
export async function registerWorkers(): Promise<void> {
  const boss = getBoss();

  await boss.work<NormalizePayload>(JOBS.NORMALIZE, async (jobs) => {
    for (const job of jobs) {
      await runNormalize(job.data.batchId, jobQueue);
    }
  });

  await boss.work<MatchPayload>(JOBS.MATCH, async (jobs) => {
    for (const job of jobs) {
      await runMatch(job.data.batchId);
    }
  });
}
