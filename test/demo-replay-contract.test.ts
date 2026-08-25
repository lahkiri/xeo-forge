/**
 * Recorded-demo replay contract tests.
 *
 * The replay (feat/v19-alive) seeds the golden-run script as a REAL task and
 * paces it client-side through the same addEvent path live SSE events take.
 * These tests pin the contract so a UI redesign or route refactor cannot
 * silently break the first-open experience:
 *
 *   1. The golden script is well-formed: ordered, typed, cadence-bounded.
 *   2. The seeding route exists, is Desktop-Local-only, honest ([Recorded
 *      demo] goal prefix), and REUSES any prior demo instead of duplicating.
 *   3. WorkClient's pacer gates the live SSE subscription in demo mode
 *      (otherwise every event would double-deliver).
 *   4. Honesty markers survive refactors: the badge text and the goal prefix.
 */

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const REPO_ROOT = path.resolve(__dirname, '..');
const readSrc = (rel: string) => fs.readFileSync(path.join(REPO_ROOT, rel), 'utf8');

describe('golden-run script integrity', () => {
  const script = readSrc('lib/demo/golden-run.ts');

  it('contains exactly 24 events in emission order', () => {
    const count = (script.match(/\{ dtms:/g) || []).length;
    expect(count).toBe(24);
  });

  it('tells the full governance loop story', () => {
    // Each act of the loop must appear at least once, in order.
    const order = ['file_read', 'plan', 'decision', "mode', content: { mode: 'build' }", 'file_edit', 'code_execute', 'verification', 'memory', 'done'];
    let cursor = 0;
    for (const marker of order) {
      const idx = script.indexOf(marker, cursor);
      expect(idx, `marker out of order: ${marker}`).toBeGreaterThan(-1);
      cursor = idx + 1;
    }
  });

  it('keeps cadence bounded (150ms–2500ms) so pacing stays snappy but readable', () => {
    const dtms = [...script.matchAll(/dtms:\s*(\d+)/g)].map((m) => Number(m[1]));
    expect(dtms.length).toBeGreaterThan(0);
    for (const d of dtms) {
      expect(d).toBeGreaterThanOrEqual(200);
      expect(d).toBeLessThanOrEqual(2500);
    }
  });

  it('ends with a completed done event carrying an honest summary', () => {
    expect(script).toMatch(/type: 'done'/);
    expect(script).toMatch(/status: 'completed'/);
    expect(script).toMatch(/Assumptions/);
  });
});

describe('demo seed route contract', () => {
  const route = readSrc('app/api/demo/route.ts');

  it('is Desktop Local only (web surface answered 403)', () => {
    expect(route).toMatch(/isDesktopLocalMode\(\)/);
    expect(route).toMatch(/Demo replay is available in Desktop Local mode/);
  });

  it('marks the task honestly with the [Recorded demo] prefix', () => {
    expect(route).toContain("DEMO_GOAL_PREFIX = '[Recorded demo]'");
    expect(route).toMatch(/goal: `\$\{DEMO_GOAL_PREFIX\}/);
  });

  it('REUSES any prior demo regardless of status (no duplicate seeding)', () => {
    // Demo tasks stay status 'pending' forever — their lifecycle is the
    // event stream. Filtering by completed/planned here caused duplicate
    // demos on every Watch click (fixed 2026-08-25).
    expect(route).toMatch(/mine\.find\(\(t\) => t\.goal\.startsWith\(DEMO_GOAL_PREFIX\)\)/);
    expect(route).not.toMatch(/status === 'completed' \| \| t\.status === 'planned'/);
    expect(route).toMatch(/reused: true/);
  });

  it('seeds every golden event through appendTaskEvent (single delivery path)', () => {
    expect(route).toMatch(/for \(const ev of GOLDEN_RUN\)/);
    expect(route).toMatch(/appendTaskEvent\(task\.id, ev\.type, ev\.content\)/);
  });
});

describe('WorkClient pacer contract', () => {
  const client = readSrc('app/work/WorkClient.tsx');

  it('starts visually empty in demo mode (pacer feeds addEvent)', () => {
    expect(client).toMatch(/parseEvents\(demoMode \? \[\] : initialEvents\)/);
  });

  it('suppresses the live SSE subscription during demo replay', () => {
    // Otherwise persisted events double-deliver alongside the pacer.
    expect(client).toMatch(/if \(isTerminal \|\| demoMode\) return;/);
    expect(client).toMatch(/\[task\.id, isTerminal, demoMode, addEvent\]/);
  });

  it('reveals events through addEvent on recorded cadence, honoring dtms bounds', () => {
    expect(client).toMatch(/const dtmsOf = /);
    expect(client).toMatch(/Math\.min\(2500, Math\.max\(150, d\.dtms\)\)/);
    expect(client).toMatch(/addEvent\(\{ seq: ev\.seq, type: ev\.type,/);
  });

  it('carries the honesty badge and a skip affordance', () => {
    expect(client).toContain('recorded demo</Badge>');
    expect(client).toContain('Skip to the end of the recording');
    expect(client).toContain('demoRevealAllRef');
  });
});

describe('decision event renders as a first-class timeline row', () => {
  const events = readSrc('lib/agent/events.ts');

  it("'decision' is a registered agent event type (work surface)", () => {
    expect(events).toMatch(/'decision',/);
    expect(events).toMatch(/decision: \{ purpose: 'A recorded operator decision/);
  });

  it("describeEvent labels it 'Operator decision recorded' with warn tone", () => {
    expect(events).toContain("title: 'Operator decision recorded'");
    // warn = the amber "awaits your attention" family until semantic-gold lands.
    expect(events).toMatch(/Operator decision recorded',[\s\S]{0,120}tone: 'warn'/);
  });

  it('is NOT silently dropped by the default:null fallthrough', () => {
    // The exact regression: default returns null and buildActivityRows skips it.
    const iDecision = events.indexOf("case 'decision':");
    const iDefault = events.indexOf('default:', iDecision);
    expect(iDecision).toBeGreaterThan(-1);
    expect(iDefault).toBeGreaterThan(iDecision); // decision case exists before default
  });
});

describe('intake wiring', () => {
  const intake = readSrc('app/work/WorkIntake.tsx');

  it('shows the watch card only in Desktop Local mode', () => {
    expect(intake).toMatch(/\{localMode && \(\r?\n\s*<button/);
  });

  it('navigates to the run with ?demo=1 after seeding', () => {
    expect(intake).toMatch(/router\.push\(`\/work\/\$\{body\.task\.id\}\?demo=1`\)/);
  });

  it('surfaces API errors honestly instead of failing silently', () => {
    expect(intake).toMatch(/setError\(body\.error \|\| 'Could not start the demo\.'\)/);
  });
});
