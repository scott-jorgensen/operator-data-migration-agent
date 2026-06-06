import 'dotenv/config';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { BatchStatus, CanonicalStatus, EntityType } from '@prisma/client';
import { prisma } from '../../src/infra/db/prisma.js';
import { LocalFsArtifactStore } from '../../src/infra/artifacts/local-fs.store.js';
import { CsvConnector } from '../../src/infra/connectors/csv.connector.js';
import { XlsxConnector } from '../../src/infra/connectors/xlsx.connector.js';
import { IngestService } from '../../src/application/ingest.service.js';
import { PublishService } from '../../src/application/publish.service.js';
import { MappingConfigSchema } from '../../src/domain/ingest/mapping.js';
import { SyncJobQueue } from '../support/sync-queue.js';
import { FakePublisher } from '../support/fake-publisher.js';

/**
 * End-to-end staging fixture exercise: the realistic 6-sheet workbook flows
 * through ingest -> normalize -> match -> commit, covering all six entity types.
 * Regenerate the fixture with `node scripts/make-staging-fixtures.mjs`.
 */
const here = dirname(fileURLToPath(import.meta.url));
const connectors = { CSV: new CsvConnector(), XLSX: new XlsxConnector() };
const ALL_ENTITY_TYPES = Object.values(EntityType);
let tmp: string;
const createdSessions: string[] = [];

beforeAll(() => {
  tmp = mkdtempSync(join(tmpdir(), 'odma-staging-'));
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

describe('staging fixtures end-to-end', () => {
  it('ingests the full workbook and publishes all six entity types', async () => {
    const session = await prisma.migrationSession.create({ data: { name: 'staging', operatorRef: 'op_staging' } });
    createdSessions.push(session.id);

    const bytes = readFileSync(join(here, '../fixtures/staging/operator-migration-sample.xlsx'));
    const ingest = new IngestService(new LocalFsArtifactStore(tmp), connectors, new SyncJobQueue());
    const { batchId } = await ingest.ingest({
      sessionId: session.id,
      filename: 'operator-migration-sample.xlsx',
      kind: 'XLSX',
      mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      bytes,
      mapping: MappingConfigSchema.parse({}),
    });

    // Clean data -> straight to READY, all six entity types present.
    const batch = await prisma.importBatch.findUnique({ where: { id: batchId } });
    expect(batch?.status).toBe(BatchStatus.READY);
    expect([...batch!.entityTypes].sort()).toEqual([...ALL_ENTITY_TYPES].sort());

    const grouped = await prisma.canonicalRecord.groupBy({
      by: ['entityType'],
      where: { batchId },
      _count: true,
    });
    const counts = Object.fromEntries(grouped.map((g) => [g.entityType, g._count]));
    expect(counts).toEqual({
      PRODUCT: 4,
      TRAVELER: 4,
      GUIDE: 3,
      QUALIFICATION: 3,
      BOOKING: 4,
      STAFFING_RULE: 3,
    });

    // Commit the whole batch through the publisher.
    const publisher = new FakePublisher();
    const publish = new PublishService(publisher);
    const result = await publish.commit(batchId);
    expect(result.status).toBe(BatchStatus.COMMITTED);
    expect(publisher.applied).toHaveLength(21); // 4+4+3+3+4+3

    const published = await prisma.canonicalRecord.count({
      where: { batchId, status: CanonicalStatus.PUBLISHED },
    });
    expect(published).toBe(21);
  });
});
