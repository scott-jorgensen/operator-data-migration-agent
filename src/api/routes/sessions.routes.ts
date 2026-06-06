import type { FastifyInstance } from 'fastify';
import { sessionService } from '../../application/container.js';
import { CreateSessionSchema } from '../schemas/requests.js';

export async function sessionRoutes(app: FastifyInstance): Promise<void> {
  app.post('/sessions', async (req, reply) => {
    const parsed = CreateSessionSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid_request', issues: parsed.error.issues });
    }
    const session = await sessionService.create(parsed.data);
    return reply.code(201).send(session);
  });

  app.get('/sessions', async () => {
    return sessionService.list();
  });

  app.get<{ Params: { id: string } }>('/sessions/:id', async (req, reply) => {
    const session = await sessionService.get(req.params.id);
    if (!session) return reply.code(404).send({ error: 'not_found' });
    return session;
  });
}
