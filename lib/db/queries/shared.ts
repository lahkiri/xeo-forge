/**
 * Package-private helpers shared by the queries domain modules.
 * NOT re-exported by the queries.ts facade — these never leave lib/db.
 */

function nowIso(): string {
  return new Date().toISOString();
}

function isUniqueViolation(err: unknown): boolean {
  const code = (err as { code?: unknown })?.code;
  const message = String((err as { message?: unknown })?.message ?? err);
  return code === '23505' || /unique constraint|duplicate key/i.test(message);
}

function normalizeMemoryContent(content: string): string {
  return content.trim().replace(/\s+/g, ' ').toLowerCase();
}

export { nowIso, isUniqueViolation, normalizeMemoryContent };
