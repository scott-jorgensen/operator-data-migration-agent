import type { SourceKind } from '@prisma/client';
import { env } from '../config/env.js';
import { LocalFsArtifactStore } from '../infra/artifacts/local-fs.store.js';
import { CsvConnector } from '../infra/connectors/csv.connector.js';
import { XlsxConnector } from '../infra/connectors/xlsx.connector.js';
import { PgBossJobQueue } from '../infra/queue/pgboss-queue.js';
import { OperatorImportStubPublisher } from '../infra/publishers/operator-import.stub.js';
import { OperatorImportHttpPublisher } from '../infra/publishers/operator-import.http.js';
import type { JobQueue } from '../ports/job-queue.port.js';
import type { PublisherPort } from '../ports/publisher.port.js';
import type { SourceConnector } from '../ports/source-connector.port.js';
import { IngestService } from './ingest.service.js';
import { PipelineService } from './pipeline.service.js';
import { PublishService } from './publish.service.js';
import { ReviewService } from './review.service.js';
import { SessionService } from './session.service.js';

/**
 * Tiny composition root. Wires concrete adapters to services so routes/workers
 * depend on interfaces, not construction details.
 */
export const artifactStore = new LocalFsArtifactStore(env.ARTIFACT_DIR);

export const connectors: Record<SourceKind, SourceConnector> = {
  CSV: new CsvConnector(),
  XLSX: new XlsxConnector(),
};

export const jobQueue: JobQueue = new PgBossJobQueue();
export const publisher: PublisherPort = buildPublisher();
export const sessionService = new SessionService();

/** Select the publisher implementation from config (stub by default). */
function buildPublisher(): PublisherPort {
  if (env.PUBLISHER === 'http') {
    if (!env.OPERATOR_IMPORT_BASE_URL || !env.OPERATOR_IMPORT_TOKEN) {
      throw new Error('PUBLISHER=http requires OPERATOR_IMPORT_BASE_URL and OPERATOR_IMPORT_TOKEN');
    }
    return new OperatorImportHttpPublisher({
      baseUrl: env.OPERATOR_IMPORT_BASE_URL,
      token: env.OPERATOR_IMPORT_TOKEN,
      timeoutMs: env.OPERATOR_IMPORT_TIMEOUT_MS,
    });
  }
  return new OperatorImportStubPublisher();
}
export const ingestService = new IngestService(artifactStore, connectors, jobQueue);
export const pipelineService = new PipelineService(jobQueue);
export const reviewService = new ReviewService();
export const publishService = new PublishService(publisher);
