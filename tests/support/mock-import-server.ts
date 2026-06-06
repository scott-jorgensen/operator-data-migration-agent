import Fastify, { type FastifyInstance } from 'fastify';
import type { FoundEntity } from '../../src/domain/publish/actions.js';

export interface MockImportServer {
  baseUrl: string;
  /** Requests received, for assertions. */
  readonly applied: unknown[];
  readonly compensated: unknown[];
  close: () => Promise<void>;
}

export interface MockOptions {
  /** Seed entities returned by GET /v1/import/entities. */
  entities?: FoundEntity[];
}

/**
 * Minimal in-process implementation of the operator import API contract, used
 * to exercise OperatorImportHttpPublisher over real HTTP. Idempotent on
 * idempotencyKey; returns a contract error envelope when a payload carries
 * `data.__fail` (to test error mapping).
 */
export async function startMockImportServer(opts: MockOptions = {}): Promise<MockImportServer> {
  const app: FastifyInstance = Fastify();
  const idem = new Map<string, string>();
  let counter = 0;
  const applied: unknown[] = [];
  const compensated: unknown[] = [];

  app.post('/v1/import/actions', async (req, reply) => {
    const body = req.body as {
      op: string;
      entityType: string;
      externalId?: string | null;
      data?: Record<string, unknown>;
      idempotencyKey: string;
    };
    if (body.data && (body.data as Record<string, unknown>).__fail) {
      return reply.code(422).send({ error: { code: 'validation_error', message: 'forced failure' } });
    }
    applied.push(body);

    let externalId = body.externalId ?? undefined;
    let idempotent = false;
    if (!externalId) {
      const existing = idem.get(body.idempotencyKey);
      if (existing) {
        externalId = existing;
        idempotent = true;
      } else {
        externalId = `ext_${body.entityType.toLowerCase()}_${++counter}`;
        idem.set(body.idempotencyKey, externalId);
      }
    }
    return { externalId, op: body.op, entityType: body.entityType, status: 'COMMITTED', idempotent };
  });

  app.post('/v1/import/actions/compensate', async (req) => {
    const body = req.body as { externalId: string };
    compensated.push(body);
    return { externalId: body.externalId, status: 'ROLLED_BACK' };
  });

  app.get('/v1/import/entities', async () => ({ results: opts.entities ?? [] }));

  app.get('/v1/import/health', async () => ({ ok: true, service: 'mock-import' }));

  await app.listen({ port: 0, host: '127.0.0.1' });
  const addr = app.server.address();
  const port = typeof addr === 'object' && addr ? addr.port : 0;

  return {
    baseUrl: `http://127.0.0.1:${port}`,
    applied,
    compensated,
    close: () => app.close(),
  };
}
