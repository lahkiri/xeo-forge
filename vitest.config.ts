import { defineConfig } from 'vitest/config';
import path from 'node:path';

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
    },
  },
});
