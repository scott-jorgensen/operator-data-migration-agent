/** Enqueues pipeline-stage jobs. Backed by pg-boss; swappable for tests. */
export interface JobQueue {
  enqueueNormalize(batchId: string): Promise<void>;
  enqueueMatch(batchId: string): Promise<void>;
}
