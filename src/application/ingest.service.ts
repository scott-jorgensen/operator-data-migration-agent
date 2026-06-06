import { createHash } from 'node:crypto';
import { BatchStatus, EntityType, type SourceKind } from '@prisma/client';
import { prisma } from '../infra/db/prisma.js';
import type { ArtifactStore } from '../ports/artifact-store.port.js';
import type { JobQueue } from '../ports/job-queue.port.js';
import type { ParsedWorkbook, SourceConnector } from '../ports/source-connector.port.js';
import { type MappingConfig, resolveEntityType } from '../domain/ingest/mapping.js';

export interface IngestInput {
  sessionId: string;
  filename: string;
  kind: SourceKind;
  mimeType: string;
  bytes: Buffer;
  mapping: MappingConfig;
}

export interface IngestResult {
  batchId: string;
  sourceConnectionId: string;
  rawArtifactId: string;
  status: BatchStatus;
  entityTypes: EntityType[];
  extractedCounts: Partial<Record<EntityType, number>>;
  unmappedSheets: string[];
}

export class SessionNotFoundError extends Error {
  constructor(public readonly sessionId: string) {
    super(`session not found: ${sessionId}`);
    this.name = 'SessionNotFoundError';
  }
}

type Connectors = Record<SourceKind, SourceConnector>;

/**
 * Owns the upload -> raw-artifact -> extracted-records flow. Extraction runs
 * inline (synchronously) for the MVP; async stages (normalize/match) move to
 * pg-boss in UNI-131. Mapping is *stored* here but applied at normalize.
 */
export class IngestService {
  constructor(
    private readonly artifacts: ArtifactStore,
    private readonly connectors: Connectors,
    private readonly queue: JobQueue,
  ) {}

  async ingest(input: IngestInput): Promise<IngestResult> {
    const session = await prisma.migrationSession.findUnique({ where: { id: input.sessionId } });
    if (!session) throw new SessionNotFoundError(input.sessionId);

    // 1. Persist raw bytes.
    const contentHash = createHash('sha256').update(input.bytes).digest('hex');
    const storageKey = `${input.sessionId}/${contentHash.slice(0, 12)}-${safeName(input.filename)}`;
    await this.artifacts.put(storageKey, input.bytes);

    // 2. Parse into a normalized workbook.
    const workbook = await this.connectors[input.kind].parse(input.bytes);

    // 3. Resolve each sheet to an entity type and build extracted records.
    const isSingleSheet = workbook.sheets.length === 1;
    // A CSV has no sheet name; fall back to the filename stem for detection
    // (e.g. "products.csv" -> "products" -> PRODUCT).
    const fallbackName = isSingleSheet ? filenameStem(input.filename) : undefined;
    const extractedRows: Array<{
      entityType: EntityType;
      sourceRowIndex: number;
      sheetName: string | null;
      rawData: Record<string, unknown>;
    }> = [];
    const unmappedSheets: string[] = [];
    const extractedCounts: Partial<Record<EntityType, number>> = {};

    for (const sheet of workbook.sheets) {
      const resolved = resolveEntityType(
        { name: sheet.name ?? fallbackName },
        input.mapping,
        isSingleSheet,
      );
      if (!resolved) {
        unmappedSheets.push(sheet.name ?? `sheet#${sheet.index}`);
        continue;
      }
      sheet.rows.forEach((rawData, rowIndex) => {
        extractedRows.push({
          entityType: resolved.entityType,
          sourceRowIndex: rowIndex,
          sheetName: sheet.name ?? null,
          rawData,
        });
      });
      extractedCounts[resolved.entityType] =
        (extractedCounts[resolved.entityType] ?? 0) + sheet.rows.length;
    }

    const entityTypes = Object.keys(extractedCounts) as EntityType[];

    // 4. Persist source connection, batch, raw artifact, and extracted records.
    const result = await prisma.$transaction(async (tx) => {
      const sourceConnection = await tx.sourceConnection.create({
        data: {
          sessionId: input.sessionId,
          kind: input.kind,
          originalFilename: input.filename,
          mappingConfig: input.mapping,
        },
      });

      const batch = await tx.importBatch.create({
        data: {
          sessionId: input.sessionId,
          sourceConnectionId: sourceConnection.id,
          status: BatchStatus.EXTRACTED,
          entityTypes,
          counts: {
            extracted: extractedCounts,
            totalRows: extractedRows.length,
            unmappedSheets,
          },
        },
      });

      const rawArtifact = await tx.rawArtifact.create({
        data: {
          batchId: batch.id,
          storageKey,
          contentHash,
          byteSize: input.bytes.byteLength,
          mimeType: input.mimeType,
          meta: workbookMeta(workbook),
        },
      });

      if (extractedRows.length > 0) {
        await tx.extractedRecord.createMany({
          data: extractedRows.map((r) => ({
            batchId: batch.id,
            entityType: r.entityType,
            sourceRowIndex: r.sourceRowIndex,
            sheetName: r.sheetName,
            rawData: r.rawData as object,
          })),
        });
      }

      return {
        batchId: batch.id,
        sourceConnectionId: sourceConnection.id,
        rawArtifactId: rawArtifact.id,
        status: batch.status,
        entityTypes,
        extractedCounts,
        unmappedSheets,
      };
    });

    // 5. Kick off async normalization (-> match -> review) via the job queue.
    await this.queue.enqueueNormalize(result.batchId);

    return result;
  }
}

function safeName(filename: string): string {
  return filename.replace(/[^a-zA-Z0-9._-]+/g, '_').slice(0, 120) || 'upload';
}

/** Filename without directory or extension, e.g. "a/b/products.csv" -> "products". */
function filenameStem(filename: string): string {
  const base = filename.split(/[\\/]/).pop() ?? filename;
  return base.replace(/\.[^.]+$/, '');
}

function workbookMeta(workbook: ParsedWorkbook): object {
  return {
    sheets: workbook.sheets.map((s) => ({
      name: s.name ?? null,
      index: s.index,
      headers: s.headers,
      rowCount: s.rows.length,
    })),
  };
}
