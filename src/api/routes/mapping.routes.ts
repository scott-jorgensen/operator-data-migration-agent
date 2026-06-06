import type { FastifyInstance } from 'fastify';
import { EntityType } from '@prisma/client';
import { columnMapper, connectors } from '../../application/container.js';
import { kindFromFilename } from '../schemas/requests.js';
import type { SheetSample } from '../../ports/column-mapper.port.js';

const SAMPLE_ROWS = 5;

/**
 * Suggest a column mapping for an uploaded spreadsheet without ingesting it.
 * The operator reviews the suggestion (per-field confidence + needsReview) and
 * then uploads with a confirmed mapping. multipart: `file` (required),
 * `entityType` (optional, applied to a single-sheet CSV).
 */
export async function mappingRoutes(app: FastifyInstance): Promise<void> {
  app.post('/mapping/suggest', async (req, reply) => {
    if (!req.isMultipart()) {
      return reply.code(415).send({ error: 'expected_multipart_form_data' });
    }

    let fileBuffer: Buffer | undefined;
    let filename = '';
    let entityTypeHint: EntityType | undefined;

    for await (const part of req.parts()) {
      if (part.type === 'file') {
        filename = part.filename;
        fileBuffer = await part.toBuffer();
      } else if (part.fieldname === 'entityType' && typeof part.value === 'string') {
        if ((Object.values(EntityType) as string[]).includes(part.value)) {
          entityTypeHint = part.value as EntityType;
        }
      }
    }

    if (!fileBuffer || !filename) return reply.code(400).send({ error: 'missing_file' });
    const kind = kindFromFilename(filename);
    if (!kind) return reply.code(400).send({ error: 'unsupported_file_type', filename });

    const workbook = await connectors[kind].parse(fileBuffer);
    const isSingleSheet = workbook.sheets.length === 1;

    const samples: SheetSample[] = workbook.sheets.map((s) => ({
      name: s.name,
      headers: s.headers,
      sampleRows: s.rows.slice(0, SAMPLE_ROWS),
      // Apply the hint only to a single-sheet file; multi-sheet relies on detection.
      entityType: isSingleSheet ? entityTypeHint : undefined,
    }));

    return columnMapper.suggest(samples);
  });
}
