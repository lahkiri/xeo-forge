/**
 * Queries — the ONLY module that reads/writes application tables.
 *
 * Every other module goes through these functions. This keeps a single
 * writer per resource and prevents schema drift (AGENTS.md rule 1).
 *
 * Since the v1.24 structural rework the implementations live in the
 * domain modules under lib/db/queries/ (users, tasks, events, admin,
 * credits, uploads, context, profiles, providers + package-private
 * shared helpers). This file is the single re-export facade: importing
 * from '@/lib/db/queries' is the only sanctioned path. Application-table
 * SQL exists ONLY inside lib/db/queries/** — enforced by
 * test/db-queries-structure.test.ts.
 *
 * Credits writes live in lib/credits/engine.ts (the single credits writer),
 * which uses the same db adapter; they are intentionally NOT duplicated here.
 */

export * from './queries/users';
export * from './queries/tasks';
export * from './queries/events';
export * from './queries/admin';
export * from './queries/credits';
export * from './queries/uploads';
export * from './queries/context';
export * from './queries/profiles';
export * from './queries/providers';
