import Fastify, { type FastifyInstance } from 'fastify';
import { loggerOptions } from './lib/logger.js';
import { prisma } from './infra/db/prisma.js';
import { registerServiceAuth } from './api/auth.js';

/**
 * Fastify app factory. Routes are registered here as the API slices land.
 * Kept free of business logic — controllers call application services.
 */
export async function buildServer(): Promise<FastifyInstance> {
  const app = Fastify({ logger: loggerOptions });

  // Service-to-service auth guards everything except public paths (/health).
  registerServiceAuth(app);

  app.get('/health', async () => {
    // Cheap liveness + DB reachability check.
    await prisma.$queryRaw`SELECT 1`;
    return { status: 'ok', service: 'operator-data-migration-agent' };
  });

  // Route registration goes here as slices land:
  //   await app.register(sessionRoutes);
  //   await app.register(batchRoutes);
  //   await app.register(reviewRoutes);
  //   await app.register(publishRoutes);

  return app;
}
