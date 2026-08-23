import { defineConfig } from 'vitest/config';
import path from 'node:path';

/**
 * XEOTEST_ALLOW_PG=1 is the explicit opt-in for running the DB-backed test
 * files against PostgreSQL instead of SQLite: `XEOTEST_ALLOW_PG=1
 * DATABASE_URL=postgres://... npx vitest run`. The default stays hermetic —
 * an ambient DATABASE_URL never silently changes what the suite exercises.
 */
const allowPg = process.env.XEOTEST_ALLOW_PG === '1';

export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '.'),
    },
  },
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
    env: {
      // Isolate preview workspaces and keep no-progress failure tests fast.
      // Read at import time by files.ts (WORK_ROOT) and preview.ts (HARD_TIMEOUT).
      TASK_WORK_DIR: path.resolve(__dirname, '.vitest-tmp/xeo-tasks'),
      PREVIEW_HARD_TIMEOUT_MS: '4000',
      // The unit suite exercises SQLite. Without this, a DATABASE_URL set in
      // the ambient shell (CI matrix, a developer's other project) silently
      // switches the DB-backed tests onto PostgreSQL and fails them for
      // environmental reasons. PG-specific translation logic is covered by
      // pg-placeholders.test.ts without a server; a real-PG integration run
      // opts in with XEOTEST_ALLOW_PG=1 (see the comment above).
      ...(allowPg ? {} : { DATABASE_URL: '' }),
    },
  },
});
