import type { FastifyInstance } from 'fastify';
import { sessionService } from '../../application/container.js';
import { prisma } from '../../infra/db/prisma.js';
import { errorBody } from '../errors.js';
import { PageQuerySchema, pageArgs, toPage } from '../pagination.js';
import { CreateSessionSchema } from '../schemas/requests.js';

export async function sessionRoutes(app: FastifyInstance): Promise<void> {
  app.post('/sessions', async (req, reply) => {
    const parsed = CreateSessionSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send(errorBody('invalid_request', 'invalid request body', parsed.error.issues));
    }
    const session = await sessionService.create(parsed.data);
    return reply.code(201).send(session);
  });

  app.get('/sessions', async (req, reply) => {
    const page = PageQuerySchema.safeParse(req.query);
    if (!page.success) return reply.code(400).send(errorBody('invalid_query', 'invalid pagination', page.error.issues));
    const rows = await prisma.migrationSession.findMany(pageArgs(page.data));
    return toPage(rows, page.data);
  });

  app.get<{ Params: { id: string } }>('/sessions/:id', async (req, reply) => {
    const session = await sessionService.get(req.params.id);
    if (!session) return reply.code(404).send(errorBody('not_found', 'session not found'));
    return session;
  });
}
