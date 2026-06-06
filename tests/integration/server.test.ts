import 'dotenv/config';
import { describe, expect, it } from 'vitest';
import { buildServer } from '../../src/server.js';

/**
 * Boots the full Fastify app (catching plugin registration / version
 * mismatches that the service-level suites miss) and checks the shared error
 * envelope. Uses `inject` — no network, no DB queries on these paths.
 */
describe('server wiring', () => {
  it('boots and returns the error envelope for missing auth and unknown routes', async () => {
    const app = await buildServer();
    try {
      const unauthorized = await app.inject({ method: 'GET', url: '/sessions' });
      expect(unauthorized.statusCode).toBe(401);
      expect(unauthorized.json()).toEqual({
        error: { code: 'unauthorized', message: expect.any(String) },
      });

      const notFound = await app.inject({
        method: 'GET',
        url: '/nope',
        headers: { authorization: `Bearer ${process.env.SERVICE_AUTH_TOKEN}` },
      });
      expect(notFound.statusCode).toBe(404);
      expect(notFound.json().error.code).toBe('not_found');
    } finally {
      await app.close();
    }
  });
});
