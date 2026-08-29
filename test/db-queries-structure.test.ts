import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import * as queries from '../lib/db/queries';

/* ------------------------------------------------------------------ */
/* db/queries package structure guard (v1.24 Phase 1.4)               */
/*                                                                     */
/* lib/db/queries.ts was decomposed into domain modules under          */
/* lib/db/queries/ with queries.ts kept as the single re-export        */
/* facade. These guards pin the new structure so it cannot silently    */
/* regress:                                                            */
/*   1. the facade stays pure (re-exports only, zero SQL),             */
/*   2. every query function has exactly ONE definition site,          */
/*   3. the public export surface equals the pre-split surface,        */
/*   4. application-table SQL lives ONLY inside lib/db/queries/**      */
/*      (plus the two documented external writers),                    */
/*   5. no consumer deep-imports the domain modules.                   */
/* Tests import the REAL facade — the same module every route, the     */
/* loop, and the tests themselves consume.                             */
/* ------------------------------------------------------------------ */

const ROOT = path.resolve(__dirname, '..');

const DOMAINS = [
  'users', 'tasks', 'events', 'admin', 'credits',
  'uploads', 'context', 'profiles', 'providers',
] as const;

/** The pre-split export surface (Indxr structure report + queries.ts inventory). */
const PINNED_EXPORTS = [
  // users & sessions
  'createUser', 'getUserById', 'getUserByEmail', 'listUsers',
  'listUsersWithStats', 'setUserSuspended', 'countUsers',
  'createSessionRow', 'getSessionWithUser', 'deleteSession',
  // tasks
  'createTask', 'getTaskById', 'resolveTaskDecision', 'getTasksByUser',
  'listAllTasks', 'claimTaskForFollowUp', 'updateTaskThinkingEffort',
  'updateTaskStatus', 'addTaskCredits', 'approveTaskPlan',
  'rejectTaskPlan', 'switchTaskMode',
  // events & messages
  'appendTaskEvent', 'getTaskEvents', 'appendMessage', 'getMessages',
  'getContextMessages', 'compactMessages',
  // model & admin
  'getModelSettings', 'upsertModelSettings', 'recordAdminAction',
  'listAdminActions',
  // credits (reads; writes live in lib/credits/engine.ts)
  'getCredits', 'getLedger',
  // uploads
  'createUpload', 'getUploadById', 'getUploadsByTask',
  'getReadyUploadsByTask', 'updateUploadStatus', 'setUploadRelPath',
  // context layers (instructions & memories)
  'listAgentInstructions', 'createAgentInstruction',
  'updateAgentInstruction', 'deleteAgentInstruction',
  'listAgentMemories', 'getActiveAgentMemories', 'createAgentMemory',
  'updateAgentMemory', 'deleteAgentMemory',
  // profiles & skills
  'listAgentProfiles', 'getAgentProfileById', 'createAgentProfile',
  'updateAgentProfile', 'deleteAgentProfile', 'listAgentSkills',
  'getAgentSkillById', 'createAgentSkill', 'updateAgentSkill',
  'deleteAgentSkill',
  // model providers
  'listModelProviders', 'listProviderModels', 'getModelProvider',
  'getProviderModel', 'createModelProvider', 'updateModelProvider',
  'createProviderModel', 'updateProviderModel',
  'getSelectedProviderModel', 'setSelectedProviderModel',
  'deleteProvider', 'deleteProviderModel',
].sort();

/** Files outside lib/db that are allowed to touch the db adapter. */
const EXTERNAL_WRITER_ALLOWLIST = [
  'lib/credits/engine.ts', // the single credits writer (documented)
  'lib/mcp/registry.ts', // mcp_servers table writer
].sort();

function read(p: string): string {
  return fs.readFileSync(path.join(ROOT, p), 'utf8');
}

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (/\.tsx?$/.test(entry.name)) out.push(full);
  }
  return out;
}

describe('db/queries package structure', () => {
  it('facade is pure re-exports — zero SQL in queries.ts', () => {
    const src = read('lib/db/queries.ts');
    expect(/INSERT\s+INTO/i.test(src)).toBe(false);
    expect(/DELETE\s+FROM/i.test(src)).toBe(false);
    expect(/UPDATE\s+\w+\s+SET/i.test(src)).toBe(false);
    expect(src.includes('db.prepare')).toBe(false);
    for (const d of DOMAINS) {
      expect(src).toContain(`export * from './queries/${d}'`);
    }
  });

  it('facade surfaces exactly the pre-split export surface', () => {
    const runtimeFns = Object.keys(queries)
      .filter((k) => typeof (queries as Record<string, unknown>)[k] === 'function')
      .sort();
    expect(runtimeFns).toEqual(PINNED_EXPORTS);
  });

  it('TaskDecisionResolution remains exported from the facade path', () => {
    // Type-level export: pin the source sites (type is erased at runtime).
    const tasksSrc = read('lib/db/queries/tasks.ts');
    expect(tasksSrc).toContain('export type TaskDecisionResolution');
  });

  it('every query function has exactly ONE definition site', () => {
    const dir = path.join(ROOT, 'lib/db/queries');
    const files = fs.readdirSync(dir).filter((f) => f.endsWith('.ts'));
    const all = files.map((f) => fs.readFileSync(path.join(dir, f), 'utf8')).join('\n');
    for (const name of PINNED_EXPORTS) {
      const re = new RegExp(`export async function ${name}\\(`, 'g');
      const sites = all.match(re) ?? [];
      expect(sites, `${name} must be defined exactly once`).toHaveLength(1);
    }
  });

  it('application-table SQL exists only inside lib/db/queries/** (allowlist pinned)', () => {
    const offenders: string[] = [];
    for (const dir of ['lib', 'app', 'components']) {
      for (const file of walk(path.join(ROOT, dir))) {
        const rel = path.relative(ROOT, file).split(path.sep).join('/');
        if (rel.startsWith('lib/db/')) continue;
        const src = fs.readFileSync(file, 'utf8');
        const usesDb = /\bdb\s*\.\s*prepare|\bdb\s*\.\s*transaction|\bgetDb\(\)/.test(
          src.replace(/\n\s*/g, ' '),
        );
        if (usesDb) offenders.push(rel);
      }
    }
    expect(offenders.sort()).toEqual(EXTERNAL_WRITER_ALLOWLIST);
  });

  it('no consumer deep-imports domain modules — the facade is the only path', () => {
    const offenders: string[] = [];
    for (const dir of ['lib', 'app', 'components']) {
      for (const file of walk(path.join(ROOT, dir))) {
        const rel = path.relative(ROOT, file).split(path.sep).join('/');
        if (rel.startsWith('lib/db/')) continue;
        const src = fs.readFileSync(file, 'utf8');
        if (/from\s+'[^']*lib\/db\/queries\//.test(src)) offenders.push(rel);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('shared helpers stay package-private (not re-exported)', () => {
    const facade = read('lib/db/queries.ts');
    expect(facade).not.toContain('nowIso');
    expect(facade).not.toContain('isUniqueViolation');
    expect(facade).not.toContain('normalizeMemoryContent');
    expect((queries as Record<string, unknown>).nowIso).toBeUndefined();
  });
});
