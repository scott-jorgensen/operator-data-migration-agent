import type { FastifyInstance } from 'fastify';
import { reviewService } from '../../application/container.js';
import { prisma } from '../../infra/db/prisma.js';
import {
  ReviewItemNotFoundError,
  ReviewItemNotOpenError,
} from '../../application/review.service.js';
import { errorBody } from '../errors.js';
import { PageQuerySchema, pageArgs, toPage } from '../pagination.js';
import { ResolveReviewSchema, ReviewListQuerySchema } from '../schemas/requests.js';

const ReviewListPageSchema = ReviewListQuerySchema.merge(PageQuerySchema);

export async function reviewRoutes(app: FastifyInstance): Promise<void> {
  // List review items for a batch — filters (status/reason/entityType) + pagination.
  app.get<{ Params: { batchId: string } }>('/batches/:batchId/review', async (req, reply) => {
    const q = ReviewListPageSchema.safeParse(req.query);
    if (!q.success) {
      return reply.code(400).send(errorBody('invalid_query', 'invalid query', q.error.issues));
    }
    const rows = await prisma.reviewItem.findMany({
      where: {
        batchId: req.params.batchId,
        status: q.data.status,
        reason: q.data.reason,
        entityType: q.data.entityType,
      },
      ...pageArgs(q.data),
    });
    return toPage(rows, q.data);
  });

  // Publish-readiness summary for a batch.
  app.get<{ Params: { batchId: string } }>('/batches/:batchId/readiness', async (req, reply) => {
    const readiness = await reviewService.readiness(req.params.batchId);
    if (!readiness) return reply.code(404).send(errorBody('not_found', 'batch not found'));
    return readiness;
  });

  app.get<{ Params: { id: string } }>('/review/:id', async (req, reply) => {
    const item = await reviewService.get(req.params.id);
    if (!item) return reply.code(404).send(errorBody('not_found', 'review item not found'));
    return item;
  });

  // Resolve a review item (ACCEPT/REJECT/REMAP/MERGE/EDIT).
  app.post<{ Params: { id: string } }>('/review/:id/resolve', async (req, reply) => {
    const parsed = ResolveReviewSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send(errorBody('invalid_request', 'invalid request body', parsed.error.issues));
    }
    try {
      return await reviewService.resolve(req.params.id, parsed.data);
    } catch (err) {
      if (err instanceof ReviewItemNotFoundError) {
        return reply.code(404).send(errorBody('not_found', 'review item not found'));
      }
      if (err instanceof ReviewItemNotOpenError) {
        return reply.code(409).send(errorBody('not_open', `review item is ${err.status}`));
      }
      throw err;
    }
  });
}
