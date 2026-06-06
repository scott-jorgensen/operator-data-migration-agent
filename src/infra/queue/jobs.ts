/** pg-boss queue names and payload shapes for the pipeline stages. */
export const JOBS = {
  NORMALIZE: 'normalize-batch',
  MATCH: 'match-batch',
} as const;

export type JobName = (typeof JOBS)[keyof typeof JOBS];

export interface NormalizePayload {
  batchId: string;
}

export interface MatchPayload {
  batchId: string;
}
