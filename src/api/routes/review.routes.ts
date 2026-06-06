import type { FastifyInstance } from 'fastify';
import { reviewService } from '../../application/container.js';
import {
  ReviewItemNotFoundError,
  ReviewItemNotOpenError,
} from '../../application/review.service.js';
import { ResolveReviewSchema, ReviewListQuerySchema } from '../schemas/requests.js';

export async function reviewRoutes(app: FastifyInstance): Promise<void> {
  // List review items for a batch, with optional status/reason/entityType filters.
  app.get<{ Params: { batchId: string } }>('/batches/:batchId/review', async (req, reply) => {
    const query = ReviewListQuerySchema.safeParse(req.query);
    if (!query.success) {
      return reply.code(400).send({ error: 'invalid_query', issues: query.error.issues });
    }
    return reviewService.list(req.params.batchId, query.data);
  });

  // Publish-readiness summary for a batch.
  app.get<{ Params: { batchId: string } }>('/batches/:batchId/readiness', async (req, reply) => {
    const readiness = await reviewService.readiness(req.params.batchId);
    if (!readiness) return reply.code(404).send({ error: 'not_found' });
    return readiness;
  });

  app.get<{ Params: { id: string } }>('/review/:id', async (req, reply) => {
    const item = await reviewService.get(req.params.id);
    if (!item) return reply.code(404).send({ error: 'not_found' });
    return item;
  });

  // Resolve a review item (ACCEPT/REJECT/REMAP/MERGE/EDIT).
  app.post<{ Params: { id: string } }>('/review/:id/resolve', async (req, reply) => {
    const parsed = ResolveReviewSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid_request', issues: parsed.error.issues });
    }
    try {
      const item = await reviewService.resolve(req.params.id, parsed.data);
      return item;
    } catch (err) {
      if (err instanceof ReviewItemNotFoundError) return reply.code(404).send({ error: 'not_found' });
      if (err instanceof ReviewItemNotOpenError) {
        return reply.code(409).send({ error: 'not_open', status: err.status });
      }
      throw err;
    }
  });
}
