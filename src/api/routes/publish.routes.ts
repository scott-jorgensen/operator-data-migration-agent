import type { FastifyInstance } from 'fastify';
import { publishService } from '../../application/container.js';
import {
  BatchNotFoundError,
  InvalidBatchStateError,
  NoCommittedBatchError,
  NotPublishableError,
} from '../../application/publish.service.js';
import { errorBody } from '../errors.js';

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

  // Roll back the most recently committed batch in a session.
  app.post<{ Params: { id: string } }>('/sessions/:id/rollback-latest', (req, reply) =>
    run(reply, () => publishService.rollbackLatestCommitted(req.params.id)),
  );
}

// Shared error mapping for the publish lifecycle endpoints.
async function run<T>(reply: import('fastify').FastifyReply, fn: () => Promise<T>): Promise<T | void> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof BatchNotFoundError) return reply.code(404).send(errorBody('not_found', 'batch not found'));
    if (err instanceof NoCommittedBatchError) {
      return reply.code(404).send(errorBody('no_committed_batch', err.message));
    }
    if (err instanceof NotPublishableError) {
      return reply.code(409).send(errorBody('not_publishable', err.message, { openReviewItems: err.openReviewItems }));
    }
    if (err instanceof InvalidBatchStateError) {
      return reply.code(409).send(errorBody('invalid_state', err.message, { status: err.status }));
    }
    throw err;
  }
}
