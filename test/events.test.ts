import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
  AGENT_EVENTS,
  AGENT_EVENT_TYPES,
  describeEvent,
  eventTypesFor,
  isAgentEventType,
  readContextLayers,
  readContextUsage,
  readFileActivity,
  readMemoryDecision,
  readRetry,
  readToolCall,
  readToolResult,
  readVerification,
} from '../lib/agent/events';

/* ------------------------------------------------------------------ */
/*  Event registry — prevents the class of bug where the backend emits */
/*  an event and no surface subscribes to it.                          */
/*                                                                     */
/*  v1.10.0 shipped `context_layers` and `memory`; both client SSE     */
/*  handlers carried hardcoded arrays that omitted them, so the events */
/*  were persisted, streamed, and silently discarded by the browser.   */
/* ------------------------------------------------------------------ */

const ROOT = path.resolve(__dirname, '..');

/** Every event type the backend actually emits, read from source. */
function emittedEventTypes(): Set<string> {
  const found = new Set<string>();
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
        continue;
      }
      if (!entry.name.endsWith('.ts') && !entry.name.endsWith('.tsx')) continue;
      const source = fs.readFileSync(full, 'utf8');
      for (const match of source.matchAll(/emitTaskEvent\([^,]+,\s*'([a-z_]+)'/g)) {
        found.add(match[1]);
      }
    }
  };
  walk(path.join(ROOT, 'lib'));
  walk(path.join(ROOT, 'app'));
  return found;
}

describe('Event registry completeness', () => {
  it('declares every event type the backend emits', () => {
    const emitted = emittedEventTypes();
    const undeclared = [...emitted].filter((type) => !isAgentEventType(type));
    expect(undeclared).toEqual([]);
  });

  it('found a non-trivial number of emit sites, so the scan is working', () => {
    // Guards against the scan silently matching nothing and passing vacuously.
    expect(emittedEventTypes().size).toBeGreaterThan(10);
  });

  it('routes every declared event to at least one surface', () => {
    for (const type of AGENT_EVENT_TYPES) {
      expect(AGENT_EVENTS[type].surfaces.length).toBeGreaterThan(0);
    }
  });

  it('documents a purpose for every declared event', () => {
    for (const type of AGENT_EVENT_TYPES) {
      expect(AGENT_EVENTS[type].purpose.length).toBeGreaterThan(0);
    }
  });

  it('subscribes Work to the events v1.10.0 added', () => {
    const work = eventTypesFor('work');
    expect(work).toContain('context_layers');
    expect(work).toContain('memory');
    expect(work).toContain('memory_decision');
  });

  it('subscribes Chat to what it needs for truthful runtime state', () => {
    const chat = eventTypesFor('chat');
    // Without tool_call, runtime state can never say "Reading project context".
    expect(chat).toContain('tool_call');
    expect(chat).toContain('tool_result');
    // Without context_layers, Chat cannot prove which memories reached the prompt.
    expect(chat).toContain('context_layers');
    expect(chat).toContain('model_retry');
  });

  it('does not subscribe Chat to planning or approval events, because Chat cannot plan', () => {
    const chat = eventTypesFor('chat');
    expect(chat).not.toContain('plan');
    expect(chat).not.toContain('verification');
    expect(chat).not.toContain('todo_update');
  });

  it('rejects an unknown event type', () => {
    expect(isAgentEventType('not_a_real_event')).toBe(false);
  });
});

describe('Payload readers', () => {
  it('reads context layers and drops malformed rows instead of throwing', () => {
    const payload = readContextLayers({
      instructions: [
        { id: 'i1', name: 'Design system', scope: 'task', priority: 200 },
        { id: 'i2' }, // no name — dropped
        { name: 'orphan' }, // no id — dropped
      ],
      memories: [
        { id: 'm1', kind: 'fact', scope: 'global', confidence: 0.8, content: 'uses pnpm' },
        {}, // dropped
      ],
    });
    expect(payload.instructions).toHaveLength(1);
    expect(payload.instructions[0].priority).toBe(200);
    expect(payload.memories).toHaveLength(1);
    expect(payload.memories[0].confidence).toBe(0.8);
  });

  it('returns empty collections for a missing payload rather than undefined', () => {
    const payload = readContextLayers({});
    expect(payload.instructions).toEqual([]);
    expect(payload.memories).toEqual([]);
  });

  it('picks the most identifying tool argument', () => {
    expect(readToolCall({ name: 'file_read', args: { path: 'a/b.ts' } }).target).toBe('a/b.ts');
    expect(readToolCall({ name: 'http_request', args: { url: 'https://x.dev' } }).target).toBe('https://x.dev');
    expect(readToolCall({ name: 'code_execute', args: { command: 'npm test' } }).target).toBe('npm test');
    expect(readToolCall({ name: 'browser', args: { action: 'read_page' } }).target).toBe('read_page');
  });

  it('defaults a nameless tool call instead of rendering undefined', () => {
    expect(readToolCall({}).name).toBe('tool');
    expect(readToolCall({}).target).toBeUndefined();
  });

  it('treats a missing ok flag as success but a false flag as failure', () => {
    expect(readToolResult({ result: 'fine' }).ok).toBe(true);
    const failed = readToolResult({ ok: false, error: 'boom' });
    expect(failed.ok).toBe(false);
    expect(failed.output).toBe('boom');
  });

  it('reads context usage in snake_case as the backend emits it', () => {
    const usage = readContextUsage({ used_tokens: 12481, context_window: 128000, percentage: 9.7 });
    expect(usage.usedTokens).toBe(12481);
    expect(usage.contextWindow).toBe(128000);
    expect(usage.percentage).toBeCloseTo(9.7);
  });

  it('ignores non-finite numbers rather than rendering NaN', () => {
    expect(readContextUsage({ used_tokens: Number.NaN }).usedTokens).toBeUndefined();
  });

  it('reads retry, verification, file activity and memory decisions', () => {
    expect(readRetry({ attempt: 2, reason: 'rate limit' })).toEqual({ attempt: 2, reason: 'rate limit' });
    expect(readVerification({ status: 'pass' }).status).toBe('pass');
    expect(readVerification({}).status).toBe('unknown');
    expect(readFileActivity({ action: 'created', path: 'x.ts' }).path).toBe('x.ts');
    expect(readFileActivity({}).action).toBe('changed');
    expect(readMemoryDecision({ memory_id: 'm1', decision: 'keep' }).decision).toBe('keep');
  });
});

describe('Activity descriptions', () => {
  it('describes context compilation with what actually reached the prompt', () => {
    const label = describeEvent('context_layers', {
      instructions: [{ id: 'i1', name: 'Rules', scope: 'global' }],
      memories: [
        { id: 'm1', kind: 'fact', scope: 'global', content: 'a' },
        { id: 'm2', kind: 'fact', scope: 'task', content: 'b' },
      ],
    });
    expect(label?.title).toBe('Context compiled');
    expect(label?.detail).toContain('1 instruction');
    expect(label?.detail).toContain('2 memories');
    expect(label?.tone).toBe('good');
  });

  it('singularises one memory correctly', () => {
    const label = describeEvent('context_layers', {
      instructions: [],
      memories: [{ id: 'm1', kind: 'fact', scope: 'task', content: 'a' }],
    });
    expect(label?.detail).toBe('1 memory');
  });

  it('names read tools as reading context and other tools by name', () => {
    expect(describeEvent('tool_call', { name: 'file_read', args: { path: 'a.ts' } })?.title)
      .toBe('Reading project context');
    expect(describeEvent('tool_call', { name: 'code_execute', args: { command: 'npm test' } })?.title)
      .toBe('Running code_execute');
  });

  it('marks a proposed memory as not yet in context', () => {
    const label = describeEvent('memory', { memory_id: 'm1', status: 'proposed' });
    expect(label?.detail).toMatch(/not in context/i);
    expect(label?.tone).toBe('warn');
  });

  it('marks a failed tool result as bad and surfaces the error', () => {
    const label = describeEvent('tool_result', { name: 'file_write', ok: false, error: 'EACCES' });
    expect(label?.tone).toBe('bad');
    expect(label?.detail).toContain('EACCES');
  });

  it('returns null for stream events that are not standalone activity', () => {
    expect(describeEvent('text', { delta: 'hello' })).toBeNull();
    expect(describeEvent('reasoning', { delta: 'x' })).toBeNull();
    expect(describeEvent('task_status', { status: 'running' })).toBeNull();
  });

  it('returns null rather than a placeholder when a payload is empty', () => {
    expect(describeEvent('context', {})).toBeNull();
    expect(describeEvent('credits', {})).toBeNull();
  });

  it('describes every registered event type without throwing', () => {
    for (const type of AGENT_EVENT_TYPES) {
      expect(() => describeEvent(type, {})).not.toThrow();
    }
  });
});
