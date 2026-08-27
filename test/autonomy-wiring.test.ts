/**
 * Autonomy WIRING contract (v1.21).
 *
 * v1.20 shipped autonomy levels as pure rule data with 22 tests — but the
 * feature was not reachable: the API did not accept a level, startAgentRun
 * never forwarded one, and (found while wiring) loop.ts created its tool
 * context BEFORE computing the rules, so even an explicit level could not
 * have reached CodeTool. This file pins the wiring itself: what a chosen
 * level means at DISPATCH time, for every tool that touches the world.
 *
 * The gate under test is authorizeToolCall() fed effectiveRules(level) —
 * exactly what tools.executeTool and loop.ts run in production, imported
 * here as the same modules (AGENTS.md rule 1: one implementation, no test
 * copies).
 */
import { describe, it, expect } from 'vitest';
import {
  AUTONOMY_LEVELS,
  effectiveRules,
  normalizeAutonomyInput,
  type PermissionRule,
} from '../lib/agent/permissions';
import { authorizeToolCall } from '../lib/agent/authority';

function rulesFor(level: Parameters<typeof effectiveRules>[0], overrides: readonly PermissionRule[] = []) {
  return effectiveRules(level, overrides);
}

describe('normalizeAutonomyInput — untrusted API input', () => {
  it('accepts every real level unchanged', () => {
    for (const level of AUTONOMY_LEVELS) {
      expect(normalizeAutonomyInput(level)).toEqual({ ok: true, level });
    }
  });

  it('defaults absence to execute WITHOUT pretending the caller chose it', () => {
    expect(normalizeAutonomyInput(undefined)).toEqual({ ok: true, level: 'execute' });
    expect(normalizeAutonomyInput(null)).toEqual({ ok: true, level: 'execute' });
    expect(normalizeAutonomyInput('')).toEqual({ ok: true, level: 'execute' });
  });

  it('rejects garbage LOUDLY instead of coercing toward broader authority', () => {
    const result = normalizeAutonomyInput('autonmous'); // typo users actually make
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toContain('autonmous');
      // Names the valid choices so a human can recover without reading source.
      expect(result.reason).toContain('read_only');
      expect(result.reason).toContain('execute');
    }
  });

  it('refuses non-string junk (arrays, objects, numbers)', () => {
    for (const junk of [42, ['autonomous'], {}, true]) {
      expect(normalizeAutonomyInput(junk).ok).toBe(false);
    }
  });
});

describe('authorizeToolCall — read_only autonomy is a real boundary at dispatch', () => {
  const rules = rulesFor('read_only');

  it('denies file writes with a cited deny message', () => {
    const verdict = authorizeToolCall('file_write', { path: 'src/a.ts', content: 'x' }, rules);
    expect(verdict.decision).toBe('deny');
    if (verdict.decision === 'deny') {
      expect(verdict.message).toContain('denies edit');
      expect(verdict.message).toContain('Read-only autonomy');
    }
  });

  it('denies code execution of ANY content — no shell at this level', () => {
    expect(authorizeToolCall('code_execute', { language: 'bash', code: 'npm test' }, rules).decision).toBe('deny');
  });

  it('fails network asks CLOSED instead of silently allowing them', () => {
    const verdict = authorizeToolCall('http_request', { method: 'GET', url: 'https://example.com' }, rules);
    expect(verdict.decision).toBe('deny');
    if (verdict.decision === 'deny') expect(verdict.message).toContain('Requires your approval');
  });

  it('still allows inspection everywhere', () => {
    expect(authorizeToolCall('file_read', { path: 'src/a.ts' }, rules).decision).toBe('pass');
    expect(authorizeToolCall('file_list', { path: '.' }, rules).decision).toBe('pass');
    expect(authorizeToolCall('git_op', { op: 'status' }, rules).decision).toBe('pass');
    expect(authorizeToolCall('git_op', { op: 'diff' }, rules).decision).toBe('pass');
  });

  it('denies third-party MCP tools outright', () => {
    const verdict = authorizeToolCall('mcp__github__create_issue', {}, rules);
    expect(verdict.decision).toBe('deny');
  });
});

describe('authorizeToolCall — secrets never read silently, at EVERY level', () => {
  it.each(AUTONOMY_LEVELS)('%s blocks file_read on .env', (level) => {
    const verdict = authorizeToolCall('file_read', { path: '.env' }, rulesFor(level));
    expect(verdict.decision).toBe('deny');
    if (verdict.decision === 'deny') expect(verdict.message).toContain('Requires your approval');
  });

  it.each(AUTONOMY_LEVELS)('%s keeps .env.example readable', (level) => {
    expect(authorizeToolCall('file_read', { path: '.env.example' }, rulesFor(level)).decision).toBe('pass');
  });
});

describe('authorizeToolCall — execute behaves like "routine work proceeds"', () => {
  const rules = rulesFor('execute');

  it('allows ordinary edits, commands, and repo-local git work', () => {
    expect(authorizeToolCall('file_write', { path: 'src/a.ts', content: 'x' }, rules).decision).toBe('pass');
    expect(authorizeToolCall('code_execute', { language: 'bash', code: 'npm test' }, rules).decision).toBe('pass');
    expect(authorizeToolCall('git_op', { op: 'add', paths: ['a.ts'] }, rules).decision).toBe('pass');
    expect(authorizeToolCall('git_op', { op: 'commit', message: 'fix' }, rules).decision).toBe('pass');
  });

  it('fail-closes publishing with the exact rule note attached', () => {
    const verdict = authorizeToolCall('code_execute', { language: 'bash', code: 'npm publish --access public' }, rules);
    expect(verdict.decision).toBe('deny');
    if (verdict.decision === 'deny') {
      expect(verdict.message).toContain('Publishes a package');
      expect(verdict.message).toContain('permission rule #');
    }
  });

  it('lets a targeted override publish again — universal denies still hold', () => {
    const overridden = rulesFor('execute', [
      { action: 'shell', resource: '*npm publish*', effect: 'allow', note: 'Trusted internal registry' },
    ]);
    expect(authorizeToolCall('code_execute', { language: 'bash', code: 'npm publish' }, overridden).decision).toBe('pass');

    // …but no override can reach the unrecoverable set, because they are
    // re-appended LAST so any override match loses to them.
    const everything: PermissionRule[] = [{ action: '*', resource: '*', effect: 'allow' }];
    const rmrf = authorizeToolCall('code_execute', { language: 'bash', code: 'rm -rf /' }, rulesFor('autonomous', everything));
    expect(rmrf.decision).toBe('deny');
  });
});

describe('authorizeToolCall — autonomous is broad but not a blank cheque', () => {
  const rules = rulesFor('autonomous');

  it('allows writes, commands, commits and pushes that stay off the deny floor', () => {
    expect(authorizeToolCall('file_edit', { path: 'a.ts', old_string: 'a', new_string: 'b' }, rules).decision).toBe('pass');
    expect(authorizeToolCall('git_op', { op: 'commit', message: 'wip' }, rules).decision).toBe('pass');
    expect(authorizeToolCall('code_execute', { language: 'bash', code: 'npm test' }, rules).decision).toBe('pass');
  });

  it('still fail-closes npm publish and denies force-push rewrites', () => {
    expect(authorizeToolCall('code_execute', { language: 'bash', code: 'npm publish' }, rules).decision).toBe('deny');
    expect(authorizeToolCall('code_execute', { language: 'bash', code: 'dd if=/dev/zero of=/dev/sda' }, rules).decision).toBe('deny');
  });
});

describe('authorizeToolCall — scope honesty', () => {
  it('passes through legacy callers with NO rule set rather than guessing authority', () => {
    expect(authorizeToolCall('file_write', { path: 'a.ts' }, undefined).decision).toBe('pass');
    expect(authorizeToolCall('code_execute', { code: 'anything' }, []).decision).toBe('pass');
  });

  it('does NOT claim authority over task bookkeeping or browser policy surfaces', () => {
    const rules = rulesFor('read_only');
    expect(authorizeToolCall('task_complete', { summary: 'done' }, rules).decision).toBe('pass');
    expect(authorizeToolCall('todo_update', {}, rules).decision).toBe('pass');
    expect(authorizeToolCall('browser', { action: 'screenshot' }, rules).decision).toBe('pass');
  });
});
