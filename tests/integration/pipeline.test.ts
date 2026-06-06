import 'dotenv/config';
import { readFileSync } from 'node:fs';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { BatchStatus, CanonicalStatus, PublishStatus, ReviewResolution, ReviewStatus } from '@prisma/client';
import { prisma } from '../../src/infra/db/prisma.js';
import { LocalFsArtifactStore } from '../../src/infra/artifacts/local-fs.store.js';
import { CsvConnector } from '../../src/infra/connectors/csv.connector.js';
import { XlsxConnector } from '../../src/infra/connectors/xlsx.connector.js';
import { IngestService } from '../../src/application/ingest.service.js';
import { PublishService } from '../../src/application/publish.service.js';
import { ReviewService } from '../../src/application/review.service.js';
import { MappingConfigSchema } from '../../src/domain/ingest/mapping.js';
import { SyncJobQueue } from '../support/sync-queue.js';
import { FakePublisher } from '../support/fake-publisher.js';

/**
 * Full-pipeline integration tests against the real Postgres. The pipeline runs
 * synchronously (SyncJobQueue) and publishes to an in-memory FakePublisher, so
 * we exercise ingest -> normalize -> match -> review -> preview/commit/rollback
 * end to end and assert on persisted state.
 *
 * Requires a running Postgres (docker compose up) with migrations applied.
 */
const here = dirname(fileURLToPath(import.meta.url));
const connectors = { CSV: new CsvConnector(), XLSX: new XlsxConnector() };
let tmp: string;
const createdSessions: string[] = [];

function fixture(name: string): Buffer {
  return readFileSync(join(here, '../fixtures', name));
}

async function ingestFixture(file: string) {
  const session = await prisma.migrationSession.create({ data: { name: 'it', operatorRef: 'op' } });
  createdSessions.push(session.id);
  const ingest = new IngestService(new LocalFsArtifactStore(tmp), connectors, new SyncJobQueue());
  const res = await ingest.ingest({
    sessionId: session.id,
    filename: file,
    kind: file.endsWith('.csv') ? 'CSV' : 'XLSX',
    mimeType: 'application/octet-stream',
    bytes: fixture(file),
    mapping: MappingConfigSchema.parse({}),
  });
  return { sessionId: session.id, batchId: res.batchId };
}

beforeAll(() => {
  tmp = mkdtempSync(join(tmpdir(), 'odma-it-'));
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

describe('pipeline integration', () => {
  it('ingests a clean CSV straight to READY, then preview/commit/rollback', async () => {
    const { batchId } = await ingestFixture('products.csv');

    const batch = await prisma.importBatch.findUnique({ where: { id: batchId } });
    expect(batch?.status).toBe(BatchStatus.READY);

    const publisher = new FakePublisher();
    const publish = new PublishService(publisher);

    const preview = await publish.preview(batchId);
    expect(preview.summary.total).toBe(3);
    expect(preview.summary.byOp.CREATE).toBe(3);

    const commit = await publish.commit(batchId);
    expect(commit.status).toBe(BatchStatus.COMMITTED);
    expect(publisher.applied).toHaveLength(3);

    const published = await prisma.canonicalRecord.findMany({ where: { batchId } });
    expect(published.every((c) => c.status === CanonicalStatus.PUBLISHED && c.externalId)).toBe(true);

    const rollback = await publish.rollback(batchId);
    expect(rollback.compensations).toBe(3);
    expect(publisher.compensated).toHaveLength(3);

    const reverted = await prisma.canonicalRecord.findMany({ where: { batchId } });
    expect(reverted.every((c) => c.status === CanonicalStatus.REVIEWED && c.externalId === null)).toBe(true);

    const rolledBack = await prisma.importBatch.findUnique({ where: { id: batchId } });
    expect(rolledBack?.status).toBe(BatchStatus.ROLLED_BACK);
  });

  it('blocks publish while review items are open, then commits after resolution', async () => {
    const { batchId } = await ingestFixture('travelers.csv');

    const batch = await prisma.importBatch.findUnique({ where: { id: batchId } });
    expect(batch?.status).toBe(BatchStatus.IN_REVIEW);

    const publish = new PublishService(new FakePublisher());
    await expect(publish.preview(batchId)).rejects.toThrow(/unresolved/);

    const review = new ReviewService();
    const open = await prisma.reviewItem.findMany({ where: { batchId, status: ReviewStatus.OPEN } });
    for (const item of open) {
      if (item.reason === 'VALIDATION_ERROR') {
        await review.resolve(item.id, {
          resolution: ReviewResolution.EDIT,
          resolvedBy: 't',
          resolutionData: { fields: { email: 'fixed@example.com' } },
        });
      } else {
        await review.resolve(item.id, { resolution: ReviewResolution.REJECT, resolvedBy: 't' });
      }
    }

    const ready = await prisma.importBatch.findUnique({ where: { id: batchId } });
    expect(ready?.status).toBe(BatchStatus.READY);

    const commit = await publish.commit(batchId);
    expect(commit.status).toBe(BatchStatus.COMMITTED);
  });

  it('resumes commit after a mid-batch failure without re-applying committed actions', async () => {
    const { batchId } = await ingestFixture('products.csv');

    const publisher = new FakePublisher();
    publisher.failOnApplyNumber = 2; // fail the 2nd apply
    const publish = new PublishService(publisher);

    await publish.preview(batchId);
    await expect(publish.commit(batchId)).rejects.toThrow(/simulated/);

    const failed = await prisma.importBatch.findUnique({ where: { id: batchId } });
    expect(failed?.status).toBe(BatchStatus.FAILED);

    let actions = await prisma.publishAction.findMany({ where: { batchId }, orderBy: { sequence: 'asc' } });
    expect(actions.filter((a) => a.status === PublishStatus.COMMITTED)).toHaveLength(1);
    expect(actions.filter((a) => a.status === PublishStatus.FAILED)).toHaveLength(1);
    const firstExternalId = actions.find((a) => a.sequence === 0)?.resultExternalId;
    expect(firstExternalId).toBeTruthy();

    // Fix and resume.
    publisher.failOnApplyNumber = null;
    const commit = await publish.commit(batchId);
    expect(commit.status).toBe(BatchStatus.COMMITTED);

    actions = await prisma.publishAction.findMany({ where: { batchId }, orderBy: { sequence: 'asc' } });
    expect(actions.every((a) => a.status === PublishStatus.COMMITTED)).toBe(true);
    // The already-committed action was not re-applied: its externalId is unchanged.
    expect(actions.find((a) => a.sequence === 0)?.resultExternalId).toBe(firstExternalId);
    // 1 successful apply before the failure + 2 on resume = 3 total.
    expect(publisher.applied).toHaveLength(3);
  });

  it('re-committing a COMMITTED batch is a no-op (idempotent)', async () => {
    const { batchId } = await ingestFixture('products.csv');
    const publisher = new FakePublisher();
    const publish = new PublishService(publisher);

    await publish.commit(batchId); // auto-previews then commits
    expect(publisher.applied).toHaveLength(3);

    await publish.commit(batchId); // nothing left to do
    expect(publisher.applied).toHaveLength(3);
  });
});
