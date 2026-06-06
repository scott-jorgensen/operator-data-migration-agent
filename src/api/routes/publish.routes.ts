import type { FastifyInstance } from 'fastify';
import { publishService } from '../../application/container.js';
import {
  BatchNotFoundError,
  InvalidBatchStateError,
  NotPublishableError,
} from '../../application/publish.service.js';

export async function publishRoutes(app: FastifyInstance): Promise<void> {
  app.post<{ Params: { id: string } }>('/batches/:id/preview', (req, reply) =>
    run(reply, () => publishService.preview(req.params.id)),
  );

  app.post<{ Params: { id: string } }>('/batches/:id/commit', (req, reply) =>
    run(reply, () => publishService.commit(req.params.id)),
  );

  app.post<{ Params: { id: string } }>('/batches/:id/rollback', (req, reply) =>
    run(reply, () => publishService.rollback(req.params.id)),
  );

  app.get<{ Params: { id: string } }>('/batches/:id/actions', async (req) =>
    publishService.listActions(req.params.id),
  );
}

// Shared error mapping for the publish lifecycle endpoints.
async function run<T>(reply: import('fastify').FastifyReply, fn: () => Promise<T>): Promise<T | void> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof BatchNotFoundError) return reply.code(404).send({ error: 'not_found' });
    if (err instanceof NotPublishableError) {
      return reply.code(409).send({ error: 'not_publishable', openReviewItems: err.openReviewItems });
    }
    if (err instanceof InvalidBatchStateError) {
      return reply.code(409).send({ error: 'invalid_state', status: err.status });
    }
    throw err;
  }
}
