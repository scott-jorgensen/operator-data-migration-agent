import { timingSafeEqual } from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { env } from '../config/env.js';

/**
 * Service-to-service authentication.
 *
 * This service is called by the operator platform (and internal tooling), not
 * by end-user browsers. Auth is a single shared bearer token presented as
 * `Authorization: Bearer <token>`, compared in constant time. This is the
 * pragmatic MVP mechanism; it can be swapped for mTLS or signed JWTs later
 * without changing call sites.
 */

// Endpoints reachable without a token (liveness probes, etc.).
const PUBLIC_PATHS = new Set<string>(['/health']);

function extractBearer(req: FastifyRequest): string | undefined {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) return undefined;
  return header.slice('Bearer '.length).trim() || undefined;
}

function tokenMatches(provided: string, expected: string): boolean {
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  // timingSafeEqual throws on length mismatch — guard first (length is not secret).
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export function registerServiceAuth(app: FastifyInstance): void {
  app.addHook('onRequest', async (req: FastifyRequest, reply: FastifyReply) => {
    const path = req.url.split('?')[0] ?? req.url;
    if (PUBLIC_PATHS.has(path)) return;

    const token = extractBearer(req);
    if (!token || !tokenMatches(token, env.SERVICE_AUTH_TOKEN)) {
      await reply.code(401).send({ error: 'unauthorized' });
    }
  });
}
