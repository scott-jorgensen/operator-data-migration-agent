import type { SourceKind } from '@prisma/client';
import { env } from '../config/env.js';
import { LocalFsArtifactStore } from '../infra/artifacts/local-fs.store.js';
import { CsvConnector } from '../infra/connectors/csv.connector.js';
import { XlsxConnector } from '../infra/connectors/xlsx.connector.js';
import { PgBossJobQueue } from '../infra/queue/pgboss-queue.js';
import { OperatorImportStubPublisher } from '../infra/publishers/operator-import.stub.js';
import type { JobQueue } from '../ports/job-queue.port.js';
import type { PublisherPort } from '../ports/publisher.port.js';
import type { SourceConnector } from '../ports/source-connector.port.js';
import { IngestService } from './ingest.service.js';
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
export const publisher: PublisherPort = new OperatorImportStubPublisher();
export const sessionService = new SessionService();
export const ingestService = new IngestService(artifactStore, connectors, jobQueue);
export const reviewService = new ReviewService();
export const publishService = new PublishService(publisher);
