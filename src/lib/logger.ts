import { pino } from 'pino';
import { env } from '../config/env.js';

/**
 * Logger options shared with Fastify (which embeds pino). Workers reuse the
 * same config via `app.log` or the standalone `logger` instance below.
 */
export const loggerOptions = {
  level: env.LOG_LEVEL,
  transport:
    env.NODE_ENV === 'development'
      ? { target: 'pino-pretty', options: { translateTime: 'HH:MM:ss', ignore: 'pid,hostname' } }
      : undefined,
};

/**
 * Standalone structured logger for code that runs outside an HTTP request
 * (pipeline workers, publish orchestration). Use `logger.child({ batchId })`
 * to bind batch context to every line of a stage.
 */
export const logger = pino(loggerOptions);
