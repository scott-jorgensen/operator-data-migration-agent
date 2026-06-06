import type { FastifyInstance } from 'fastify';
import { BatchStatus } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../../infra/db/prisma.js';
import { ingestService, pipelineService, publishService, reviewService } from '../../application/container.js';
import { SessionNotFoundError } from '../../application/ingest.service.js';
import { BatchNotFoundError } from '../../application/publish.service.js';
import { MappingConfigSchema } from '../../domain/ingest/mapping.js';
import { errorBody } from '../errors.js';
import { PageQuerySchema, pageArgs, toPage } from '../pagination.js';
import { kindFromFilename } from '../schemas/requests.js';

const BatchListQuerySchema = PageQuerySchema.extend({ status: z.nativeEnum(BatchStatus).optional() });

export async function batchRoutes(app: FastifyInstance): Promise<void> {
  // Upload a CSV/XLSX -> SourceConnection + ImportBatch + RawArtifact + ExtractedRecords.
  // multipart/form-data: `file` (required), `mapping` (optional JSON MappingConfig).
  app.post<{ Params: { sessionId: string } }>(
    '/sessions/:sessionId/batches',
    async (req, reply) => {
      if (!req.isMultipart()) {
        return reply.code(415).send(errorBody('expected_multipart', 'expected multipart/form-data'));
      }

      let fileBuffer: Buffer | undefined;
      let filename = '';
      let mimeType = 'application/octet-stream';
      let mappingRaw: string | undefined;

      for await (const part of req.parts()) {
        if (part.type === 'file') {
          filename = part.filename;
          mimeType = part.mimetype || mimeType;
          fileBuffer = await part.toBuffer();
        } else if (part.fieldname === 'mapping') {
          mappingRaw = typeof part.value === 'string' ? part.value : String(part.value);
        }
      }

      if (!fileBuffer || !filename) {
        return reply.code(400).send(errorBody('missing_file', 'a file part is required'));
      }

      const kind = kindFromFilename(filename);
      if (!kind) {
        return reply.code(400).send(errorBody('unsupported_file_type', `unsupported file: ${filename}`));
      }

      let mapping;
      try {
        const raw: unknown = mappingRaw ? JSON.parse(mappingRaw) : {};
        const parsed = MappingConfigSchema.safeParse(raw);
        if (!parsed.success) {
          return reply.code(400).send(errorBody('invalid_mapping', 'invalid mapping', parsed.error.issues));
        }
        mapping = parsed.data;
      } catch {
        return reply.code(400).send(errorBody('invalid_mapping_json', 'mapping is not valid JSON'));
      }

      try {
        const result = await ingestService.ingest({
          sessionId: req.params.sessionId,
          filename,
          kind,
          mimeType,
          bytes: fileBuffer,
          mapping,
        });
        return reply.code(201).send(result);
      } catch (err) {
        if (err instanceof SessionNotFoundError) {
          return reply.code(404).send(errorBody('session_not_found', 'session not found'));
        }
        throw err;
      }
    },
  );

  app.get<{ Params: { sessionId: string } }>(
    '/sessions/:sessionId/batches',
    async (req, reply) => {
      const q = BatchListQuerySchema.safeParse(req.query);
      if (!q.success) return reply.code(400).send(errorBody('invalid_query', 'invalid query', q.error.issues));
      const rows = await prisma.importBatch.findMany({
        where: { sessionId: req.params.sessionId, status: q.data.status },
        ...pageArgs(q.data),
      });
      return toPage(rows, q.data);
    },
  );

  app.get<{ Params: { id: string } }>('/batches/:id', async (req, reply) => {
    const batch = await prisma.importBatch.findUnique({
      where: { id: req.params.id },
      include: {
        sourceConnection: true,
        rawArtifacts: true,
        _count: { select: { extractedRecords: true } },
      },
    });
    if (!batch) return reply.code(404).send(errorBody('not_found', 'batch not found'));
    return batch;
  });

  // Observability: a single batch-lifecycle view — status, counts/timings,
  // error, readiness, the review audit trail, and the publish log.
  app.get<{ Params: { id: string } }>('/batches/:id/timeline', async (req, reply) => {
    const batch = await prisma.importBatch.findUnique({ where: { id: req.params.id } });
    if (!batch) return reply.code(404).send(errorBody('not_found', 'batch not found'));
    const [readiness, reviewEvents, publishActions] = await Promise.all([
      reviewService.readiness(batch.id),
      prisma.reviewEvent.findMany({ where: { batchId: batch.id }, orderBy: { createdAt: 'asc' } }),
      publishService.listActions(batch.id),
    ]);
    return {
      batch: {
        id: batch.id,
        sessionId: batch.sessionId,
        status: batch.status,
        counts: batch.counts,
        error: batch.error,
        createdAt: batch.createdAt,
        updatedAt: batch.updatedAt,
      },
      readiness,
      reviewEvents,
      publishActions,
    };
  });

  // Recover a failed (or stuck) pipeline by re-running normalize -> match.
  app.post<{ Params: { id: string } }>('/batches/:id/retry', async (req, reply) => {
    try {
      return await pipelineService.retry(req.params.id);
    } catch (err) {
      if (err instanceof BatchNotFoundError) return reply.code(404).send(errorBody('not_found', 'batch not found'));
      throw err;
    }
  });
}
