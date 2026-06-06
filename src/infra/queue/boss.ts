import PgBoss from 'pg-boss';
import { env } from '../../config/env.js';
import { JOBS } from './jobs.js';

/**
 * pg-boss lives in the same Postgres DB as the app (own schema). Started once
 * per process — by the API (to enqueue) and by the worker (to enqueue + work).
 */
let boss: PgBoss | undefined;

export async function startBoss(): Promise<PgBoss> {
  if (boss) return boss;
  const instance = new PgBoss({ connectionString: env.DATABASE_URL, schema: env.PGBOSS_SCHEMA });
  instance.on('error', (err) => {
    // eslint-disable-next-line no-console
    console.error('[pg-boss] error:', err);
  });
  await instance.start();
  // Queues must exist before send/work in pg-boss v10. Idempotent.
  // retryLimit 0: a failed stage stays FAILED for manual retry (POST
  // /batches/:id/retry) rather than auto-looping.
  for (const name of Object.values(JOBS)) {
    await instance.createQueue(name, { name, retryLimit: 0 });
  }
  boss = instance;
  return boss;
}

export function getBoss(): PgBoss {
  if (!boss) throw new Error('pg-boss not started — call startBoss() first');
  return boss;
}

export async function stopBoss(): Promise<void> {
  if (boss) {
    await boss.stop();
    boss = undefined;
  }
}
