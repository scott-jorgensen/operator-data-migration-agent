import Fastify, { type FastifyInstance } from 'fastify';
import multipart from '@fastify/multipart';
import rateLimit from '@fastify/rate-limit';
import { loggerOptions } from './lib/logger.js';
import { prisma } from './infra/db/prisma.js';
import { registerServiceAuth } from './api/auth.js';
import { errorBody, registerErrorHandlers } from './api/errors.js';
import { sessionRoutes } from './api/routes/sessions.routes.js';
import { batchRoutes } from './api/routes/batches.routes.js';
import { reviewRoutes } from './api/routes/review.routes.js';
import { publishRoutes } from './api/routes/publish.routes.js';
import { mappingRoutes } from './api/routes/mapping.routes.js';

// Upload ceiling for raw source files (generous for spreadsheets, MVP-safe).
const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;
// JSON body ceiling for non-upload requests.
const MAX_JSON_BYTES = 1 * 1024 * 1024;

/**
 * Fastify app factory. Routes are registered here as the API slices land.
 * Kept free of business logic — controllers call application services.
 */
export async function buildServer(): Promise<FastifyInstance> {
  const app = Fastify({ logger: loggerOptions, bodyLimit: MAX_JSON_BYTES });

  // Consistent error envelope for thrown errors, validation, and unknown routes.
  registerErrorHandlers(app);

  // Basic abuse protection (per-IP). Generous default for an internal service.
  await app.register(rateLimit, {
    max: 300,
    timeWindow: '1 minute',
    errorResponseBuilder: (_req, ctx) =>
      errorBody('rate_limited', `rate limit exceeded, retry in ${Math.ceil(ctx.ttl / 1000)}s`),
  });

  // Service-to-service auth guards everything except public paths (/health).
  registerServiceAuth(app);

  await app.register(multipart, { limits: { fileSize: MAX_UPLOAD_BYTES, files: 1 } });

  app.get('/health', async () => {
    // Cheap liveness + DB reachability check.
    await prisma.$queryRaw`SELECT 1`;
    return { status: 'ok', service: 'operator-data-migration-agent' };
  });

  await app.register(sessionRoutes);
  await app.register(batchRoutes);
  await app.register(reviewRoutes);
  await app.register(publishRoutes);
  await app.register(mappingRoutes);

  return app;
}
