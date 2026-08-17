import { initSchema } from './schema';

let schemaPromise: Promise<void> | undefined;

/**
 * Ensure the canonical schema exists before any auth/session/credits query.
 * The promise is shared by concurrent requests so startup cannot race itself.
 */
export function ensureSchema(): Promise<void> {
  if (!schemaPromise) {
    schemaPromise = initSchema().catch((error) => {
      schemaPromise = undefined;
      console.error('[db] schema initialization failed:', error);
      throw error;
    });
  }
  return schemaPromise;
}
