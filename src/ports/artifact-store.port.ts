/**
 * Storage for raw uploaded bytes (the original CSV/XLSX). Local disk for MVP;
 * swappable for S3/GCS later without touching ingestion code.
 */
export interface ArtifactStore {
  /** Persist `bytes` under `key`. Overwrites if the key already exists. */
  put(key: string, bytes: Buffer): Promise<void>;
  /** Read the bytes previously stored under `key`. */
  get(key: string): Promise<Buffer>;
}
