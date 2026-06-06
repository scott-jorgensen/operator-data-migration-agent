import 'dotenv/config';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { BatchStatus } from '@prisma/client';
import { prisma } from '../../src/infra/db/prisma.js';
import { LocalFsArtifactStore } from '../../src/infra/artifacts/local-fs.store.js';
import { CsvConnector } from '../../src/infra/connectors/csv.connector.js';
import { XlsxConnector } from '../../src/infra/connectors/xlsx.connector.js';
import { IngestService } from '../../src/application/ingest.service.js';
import { PipelineService } from '../../src/application/pipeline.service.js';
import { PublishService, NoCommittedBatchError } from '../../src/application/publish.service.js';
import { MappingConfigSchema } from '../../src/domain/ingest/mapping.js';
import { SyncJobQueue } from '../support/sync-queue.js';
import { FakePublisher } from '../support/fake-publisher.js';

const here = dirname(fileURLToPath(import.meta.url));
const connectors = { CSV: new CsvConnector(), XLSX: new XlsxConnector() };
let tmp: string;
const createdSessions: string[] = [];

function fixture(name: string): Buffer {
  return readFileSync(join(here, '../fixtures', name));
}

async function newSession(): Promise<string> {
  const s = await prisma.migrationSession.create({ data: { name: 'it', operatorRef: 'op' } });
  createdSessions.push(s.id);
  return s.id;
}

async function ingestInto(sessionId: string, file: string): Promise<string> {
  const ingest = new IngestService(new LocalFsArtifactStore(tmp), connectors, new SyncJobQueue());
  const res = await ingest.ingest({
    sessionId,
    filename: file,
    kind: 'CSV',
    mimeType: 'text/csv',
    bytes: fixture(file),
    mapping: MappingConfigSchema.parse({}),
  });
  return res.batchId;
}

beforeAll(() => {
  tmp = mkdtempSync(join(tmpdir(), 'odma-hard-'));
});
afterEach(async () => {
  if (createdSessions.length) {
    await prisma.migrationSession.deleteMany({ where: { id: { in: createdSessions } } });
    createdSessions.length = 0;
  }
});
afterAll(async () => {
  await prisma.$disconnect();
});

describe('observability + hardening', () => {
  it('records per-stage timings in batch counts', async () => {
    const batchId = await ingestInto(await newSession(), 'products.csv');
    const batch = await prisma.importBatch.findUnique({ where: { id: batchId } });
    const timings = (batch?.counts as { timings?: Record<string, number> }).timings ?? {};
    expect(typeof timings.normalizeMs).toBe('number');
    expect(typeof timings.matchMs).toBe('number');
  });

  it('retry re-runs the pipeline and clears a FAILED batch', async () => {
    const batchId = await ingestInto(await newSession(), 'products.csv');
    // Simulate a prior pipeline failure.
    await prisma.importBatch.update({
      where: { id: batchId },
      data: { status: BatchStatus.FAILED, error: { stage: 'normalize', message: 'boom' } },
    });

    await new PipelineService(new SyncJobQueue()).retry(batchId);

    const batch = await prisma.importBatch.findUnique({ where: { id: batchId } });
    expect(batch?.status).toBe(BatchStatus.READY);
    expect(batch?.error).toBeNull();
  });

  it('rolls back the most recently committed batch in a session', async () => {
    const sessionId = await newSession();
    const publish = new PublishService(new FakePublisher());

    const batchA = await ingestInto(sessionId, 'products.csv');
    await publish.commit(batchA);
    const batchB = await ingestInto(sessionId, 'products.csv');
    await publish.commit(batchB);

    const res = await publish.rollbackLatestCommitted(sessionId);
    expect(res.batchId).toBe(batchB);

    const a = await prisma.importBatch.findUnique({ where: { id: batchA } });
    const b = await prisma.importBatch.findUnique({ where: { id: batchB } });
    expect(b?.status).toBe(BatchStatus.ROLLED_BACK);
    expect(a?.status).toBe(BatchStatus.COMMITTED);
  });

  it('throws when a session has no committed batch to roll back', async () => {
    const sessionId = await newSession();
    await expect(
      new PublishService(new FakePublisher()).rollbackLatestCommitted(sessionId),
    ).rejects.toBeInstanceOf(NoCommittedBatchError);
  });
});
