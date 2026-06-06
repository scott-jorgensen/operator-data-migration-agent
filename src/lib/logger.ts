import { env } from '../config/env.js';

/**
 * Logger options shared with Fastify (which embeds pino). Workers reuse the
 * same config via `app.log` or a standalone pino instance if needed.
 */
export const loggerOptions = {
  level: env.LOG_LEVEL,
  transport:
    env.NODE_ENV === 'development'
      ? { target: 'pino-pretty', options: { translateTime: 'HH:MM:ss', ignore: 'pid,hostname' } }
      : undefined,
};
