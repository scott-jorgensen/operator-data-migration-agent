import { BatchStatus, type EntityType, Prisma } from '@prisma/client';
import { prisma } from '../infra/db/prisma.js';
import { buildCanonical } from '../domain/canonical/normalize.js';
import { MappingConfigSchema } from '../domain/ingest/mapping.js';
import type { JobQueue } from '../ports/job-queue.port.js';

/**
 * Normalize stage: ExtractedRecord -> CanonicalRecord. Validates each row
 * against its per-entity Zod schema, derives promoted match keys, and raises a
 * VALIDATION_ERROR review item for rows that fail validation. Idempotent:
 * clears prior canonical records for the batch (cascading old matches/reviews)
 * before rebuilding. Enqueues the match stage on completion.
 */
export async function runNormalize(batchId: string, queue: JobQueue): Promise<void> {
  const batch = await prisma.importBatch.findUnique({
    where: { id: batchId },
    include: { sourceConnection: true },
  });
  if (!batch) return;

  await prisma.importBatch.update({ where: { id: batchId }, data: { status: BatchStatus.NORMALIZING } });

  const mapping = MappingConfigSchema.parse(batch.sourceConnection.mappingConfig ?? {});
  const extracted = await prisma.extractedRecord.findMany({ where: { batchId } });

  // Idempotent rebuild.
  await prisma.canonicalRecord.deleteMany({ where: { batchId } });

  const normalizedCounts: Partial<Record<EntityType, number>> = {};
  let validationFlags = 0;

  for (const er of extracted) {
    const columns = columnsFor(mapping, er.entityType, er.sheetName);
    const { data, keys, validationErrors } = buildCanonical(
      er.entityType,
      er.rawData as Record<string, unknown>,
      columns,
    );

    const canonical = await prisma.canonicalRecord.create({
      data: {
        batchId,
        sessionId: batch.sessionId,
        entityType: er.entityType,
        sourceRecordId: er.id,
        data: data as Prisma.InputJsonValue,
        dedupeKey: keys.dedupeKey,
        keyEmail: keys.keyEmail,
        keyCode: keys.keyCode,
        keyName: keys.keyName,
        keyDate: keys.keyDate,
      },
    });

    normalizedCounts[er.entityType] = (normalizedCounts[er.entityType] ?? 0) + 1;

    if (validationErrors.length > 0) {
      validationFlags++;
      await prisma.reviewItem.create({
        data: {
          batchId,
          canonicalRecordId: canonical.id,
          entityType: er.entityType,
          reason: 'VALIDATION_ERROR',
          priority: 2,
          details: {
            explanation: `This row has validation problems: ${validationErrors.join('; ')}.`,
            validationErrors,
          },
        },
      });
    }
  }

  await prisma.importBatch.update({
    where: { id: batchId },
    data: {
      status: BatchStatus.NORMALIZED,
      counts: {
        ...(batch.counts as object),
        normalized: normalizedCounts,
        validationFlags,
      },
    },
  });

  await queue.enqueueMatch(batchId);
}

/** Resolve the column map for an extracted record's entity/sheet. */
function columnsFor(
  mapping: { sheets: Array<{ entityType: EntityType; sheet?: string; columns: Record<string, string> }> },
  entityType: EntityType,
  sheetName: string | null,
): Record<string, string> {
  const bySheet = sheetName
    ? mapping.sheets.find((s) => s.sheet && s.sheet.toLowerCase() === sheetName.toLowerCase())
    : undefined;
  if (bySheet) return bySheet.columns;
  return mapping.sheets.find((s) => s.entityType === entityType)?.columns ?? {};
}
