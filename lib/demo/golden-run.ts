/**
 * The golden demo run — a recorded governed task replayed for first-open.
 *
 * WHY THIS EXISTS: a new user's first open used to show empty surfaces.
 * This script is a REAL shaped run (same event types the loop emits, same
 * seq ordering) that the Work surface can pace out visually so a visitor
 * watches the full governance loop — inspect, plan, approve, build,
 * verify, memory proposals — without configuring any provider.
 *
 * HONESTY CONTRACT: every consumer of this script must label it as a
 * recorded demonstration. It is never presented as a live model run.
 */

export interface DemoEvent {
  /** Milliseconds to wait after the previous event before revealing this one. */
  dtms: number;
  type: string;
  content: Record<string, unknown>;
}

export const DEMO_GOAL =
  'Add a multiply(a, b) helper to src/calc.py with a pytest case, then run the suite.';

export const DEMO_PROJECT = 'xeo-lab';

const PLAN_TEXT = `# Plan: add multiply() to xeo-lab

## Inspection (read-only)
1. Read src/calc.py — currently exposes add() and sub().
2. Read tests/test_calc.py — one test, imports from src.calc.

## Change
3. Append multiply(a, b) returning a * b, with a short docstring.
4. Add test_multiply covering 2*3=6 and (-2)*4=-8.

## Verification
5. Run python -m pytest -q inside the workspace; require exit 0.

## Assumptions
- No naming conflicts: multiply does not exist yet.`;

/** Full golden script, in emission order. */
export const GOLDEN_RUN: DemoEvent[] = [
  { dtms: 400, type: 'mode', content: { mode: 'planning' } },
  { dtms: 200, type: 'task_status', content: { status: 'running' } },
  { dtms: 500, type: 'intent', content: { kind: 'explicit_plan', reason: 'demo_replay', confidence: 0.95 } },
  { dtms: 600, type: 'context', content: { used_tokens: 1180, context_window: 128000, percentage: 0.9, threshold: 80 } },

  // ── Planning: read-only inspection ──
  { dtms: 700, type: 'tool_call', content: { name: 'file_read', args: { path: 'src/calc.py' } } },
  { dtms: 650, type: 'tool_result', content: { name: 'file_read', ok: true, result: 'def add(a, b):\n    return a + b\n\ndef sub(a, b):\n    return a - b\n' } },
  { dtms: 500, type: 'file_activity', content: { action: 'listed', path: 'src' } },
  { dtms: 800, type: 'tool_call', content: { name: 'file_read', args: { path: 'tests/test_calc.py' } } },
  { dtms: 600, type: 'tool_result', content: { name: 'file_read', ok: true, result: 'from src.calc import add\n\ndef test_add():\n    assert add(2, 3) == 5\n' } },

  // ── The plan arrives ──
  { dtms: 900, type: 'text', content: { delta: 'I inspected both files and drafted the plan below.' } },
  { dtms: 700, type: 'plan', content: { plan: PLAN_TEXT, plan_version: 0 } },
  { dtms: 400, type: 'task_status', content: { status: 'planned' } },
  { dtms: 2500, type: 'decision', content: { kind: 'plan_approved_by_operator', note: '(recorded operator decision)' } },

  // ── Build mode: gated writes ──
  { dtms: 500, type: 'mode', content: { mode: 'build' } },
  { dtms: 300, type: 'task_status', content: { status: 'running' } },
  { dtms: 900, type: 'tool_call', content: { name: 'file_edit', args: { path: 'src/calc.py' } } },
  { dtms: 600, type: 'tool_result', content: { name: 'file_edit', ok: true, result: 'ok' } },
  { dtms: 350, type: 'file_activity', content: { action: 'edited', path: 'src/calc.py' } },
  { dtms: 850, type: 'tool_call', content: { name: 'file_write', args: { path: 'tests/test_calc.py' } } },
  { dtms: 550, type: 'tool_result', content: { name: 'file_write', ok: true, result: 'ok' } },
  { dtms: 350, type: 'file_activity', content: { action: 'created', path: 'tests/test_calc.py' } },
  { dtms: 950, type: 'tool_call', content: { name: 'code_execute', args: { command: 'python -m pytest -q' } } },
  {
    dtms: 1200,
    type: 'tool_result',
    content: { name: 'code_execute', ok: true, result: 'exit=0\n.. \n2 passed in 0.04s' },
  },

  // ── Verification + engineering memory ──
  { dtms: 700, type: 'verification', content: { status: 'pass', attempt: 1, message: 'Verified: 5 tool calls, 2 files modified, 1 code execution, 0 errors.' } },
  { dtms: 600, type: 'memory', content: { kind: 'fact', scope: 'project', status: 'proposed', confidence: 0.8, content: 'xeo-lab uses plain pytest; tests import helpers from src.*' } },
  {
    dtms: 500,
    type: 'done',
    content: {
      status: 'completed',
      summary:
        'Added multiply(a, b) to src/calc.py and two pytest cases; suite passes (2 passed). Assumptions: no prior multiply existed. Decisions: kept arithmetic helpers grouped in calc.py.',
    },
  },
];

export const DEMO_TOTAL_MS = GOLDEN_RUN.reduce((acc, e) => acc + e.dtms, 0);
