import type { FastifyInstance } from 'fastify';

/** A consistent error envelope across all routes: { error: { code, message, details? } }. */
export function errorBody(code: string, message: string, details?: unknown) {
  return { error: { code, message, ...(details === undefined ? {} : { details }) } };
}

/** Throwable error that the global handler renders into the envelope. */
export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message?: string,
    public readonly details?: unknown,
  ) {
    super(message ?? code);
    this.name = 'ApiError';
  }
}

/**
 * Register global handlers so every response — thrown ApiError, Fastify
 * validation/multipart/rate-limit errors, unknown routes — uses one envelope.
 */
export function registerErrorHandlers(app: FastifyInstance): void {
  app.setNotFoundHandler((req, reply) => {
    reply.code(404).send(errorBody('not_found', `route not found: ${req.method} ${req.url}`));
  });

  app.setErrorHandler((err, req, reply) => {
    if (err instanceof ApiError) {
      return reply.code(err.status).send(errorBody(err.code, err.message, err.details));
    }
    const status = (err as { statusCode?: number }).statusCode ?? 500;
    if (status >= 500) req.log.error({ err }, 'unhandled error');
    const code =
      status === 429 ? 'rate_limited' : status === 413 ? 'payload_too_large' : status >= 500 ? 'internal' : 'bad_request';
    const message = status >= 500 ? 'internal server error' : err.message;
    return reply.code(status).send(errorBody(code, message));
  });
}
