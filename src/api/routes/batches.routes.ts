import type { FastifyInstance } from 'fastify';
import { prisma } from '../../infra/db/prisma.js';
import { ingestService } from '../../application/container.js';
import { SessionNotFoundError } from '../../application/ingest.service.js';
import { MappingConfigSchema } from '../../domain/ingest/mapping.js';
import { kindFromFilename } from '../schemas/requests.js';

export async function batchRoutes(app: FastifyInstance): Promise<void> {
  // Upload a CSV/XLSX -> SourceConnection + ImportBatch + RawArtifact + ExtractedRecords.
  // multipart/form-data: `file` (required), `mapping` (optional JSON MappingConfig).
  app.post<{ Params: { sessionId: string } }>(
    '/sessions/:sessionId/batches',
    async (req, reply) => {
      if (!req.isMultipart()) {
        return reply.code(415).send({ error: 'expected_multipart_form_data' });
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
        return reply.code(400).send({ error: 'missing_file' });
      }

      const kind = kindFromFilename(filename);
      if (!kind) {
        return reply.code(400).send({ error: 'unsupported_file_type', filename });
      }

      let mapping;
      try {
        const raw: unknown = mappingRaw ? JSON.parse(mappingRaw) : {};
        const parsed = MappingConfigSchema.safeParse(raw);
        if (!parsed.success) {
          return reply.code(400).send({ error: 'invalid_mapping', issues: parsed.error.issues });
        }
        mapping = parsed.data;
      } catch {
        return reply.code(400).send({ error: 'invalid_mapping_json' });
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
          return reply.code(404).send({ error: 'session_not_found' });
        }
        throw err;
      }
    },
  );

  app.get<{ Params: { sessionId: string } }>(
    '/sessions/:sessionId/batches',
    async (req) => {
      return prisma.importBatch.findMany({
        where: { sessionId: req.params.sessionId },
        orderBy: { createdAt: 'desc' },
      });
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
    if (!batch) return reply.code(404).send({ error: 'not_found' });
    return batch;
  });
}
