import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Load .env so integration tests get DATABASE_URL etc. (harmless for units).
    setupFiles: ['dotenv/config'],
    // Integration tests hit a shared Postgres — run files serially to avoid races.
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
