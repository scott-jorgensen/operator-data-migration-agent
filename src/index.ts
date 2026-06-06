import { env } from './config/env.js';
import { buildServer } from './server.js';
import { disconnectPrisma } from './infra/db/prisma.js';

/**
 * Entrypoint. The same process can run the API, the worker, or both, selected
 * by CLI flags so we have one deployable but can scale roles independently:
 *   node dist/index.js --api          # HTTP only
 *   node dist/index.js --worker       # pg-boss workers only
 *   node dist/index.js --api --worker # both (default for local dev)
 */
async function main(): Promise<void> {
  const flags = new Set(process.argv.slice(2));
  const runApi = flags.has('--api') || flags.size === 0;
  const runWorker = flags.has('--worker') || flags.size === 0;

  const shutdownHooks: Array<() => Promise<void>> = [];

  if (runApi) {
    const app = await buildServer();
    await app.listen({ port: env.PORT, host: env.HOST });
    shutdownHooks.push(async () => {
      await app.close();
    });
  }

  if (runWorker) {
    // Wired in slice 4 (pg-boss bootstrap + worker registration).
    // const boss = await startWorkers();
    // shutdownHooks.push(() => boss.stop());
  }

  const shutdown = async (signal: string): Promise<void> => {
    // eslint-disable-next-line no-console
    console.log(`\nReceived ${signal}, shutting down...`);
    for (const hook of shutdownHooks.reverse()) {
      await hook().catch(() => undefined);
    }
    await disconnectPrisma();
    process.exit(0);
  };

  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('Fatal startup error:', err);
  process.exit(1);
});
