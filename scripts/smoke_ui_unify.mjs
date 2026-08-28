#!/usr/bin/env node
/**
 * Local smoke for the v1.22 UI-unify + chat-hang work (Node 24 type-stripping).
 *
 * The repo's node_modules cannot install here (better-sqlite3 native build —
 * same ENV LIMITATION as the v1.21 wiring smoke), so this verifies what is
 * verifiable without vitest:
 *   S1 runtime-state.isTerminalTaskStatus behavior (pure module, real import).
 *   S2 Source contracts in ChatClient / WorkClient (same assertions as
 *      test/chat-hang-reconciliation.test.ts, mirrored).
 *   S3 Glyph eradication: no unicode icon glyphs remain in app/components tsx
 *      (the icon set in components/icons.tsx is now the single source).
 *   S4 Icon-library integrity: every Icon* exported from components/icons.tsx
 *      has a matching usage import somewhere in the app.
 */
import fs from 'node:fs';
import path from 'node:path';
import { isTerminalTaskStatus } from '../lib/agent/runtime-state.ts';

const ROOT = path.resolve(import.meta.dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

let passed = 0;
let failed = 0;
function check(name, fn) {
  try {
    fn();
    passed += 1;
    console.log(`  ok - ${name}`);
  } catch (err) {
    failed += 1;
    console.error(`  FAIL - ${name}\n      ${err.message}`);
  }
}
function assert(cond, msg) {
  if (!cond) throw new Error(msg || 'assertion failed');
}

console.log('S1 runtime-state terminal vocabulary');
check('completed/failed/cancelled/planned are terminal', () => {
  for (const s of ['completed', 'failed', 'cancelled', 'planned']) {
    assert(isTerminalTaskStatus(s), `${s} should be terminal`);
  }
});
check('running/pending/awaiting_* are not terminal', () => {
  for (const s of ['running', 'pending', 'awaiting_decision', 'awaiting_approval']) {
    assert(!isTerminalTaskStatus(s), `${s} should NOT be terminal`);
  }
});

console.log('S2 chat hang reconciliation contracts');
const chat = read('app/chat/ChatClient.tsx');
check('SSE guard uses isTerminalTaskStatus', () => {
  assert(chat.includes('if (!activeTask || isTerminalTaskStatus(status)) return;'), 'guard missing');
});
check('reconciliation poll reads the task row', () => {
  assert(chat.includes("fetch(`/api/tasks/${activeTask.id}`, { cache: 'no-store' })"), 'poll fetch missing');
  assert(chat.includes('isTerminalTaskStatus(serverStatus)'), 'adoption check missing');
  assert(chat.includes('setStatus(serverStatus as TaskStatus)'), 'setStatus adoption missing');
});
check('persisted answer surfaces via router.refresh', () => {
  assert(chat.includes('router.refresh()'), 'refresh missing');
});
check('Stop escape hatch + cancel endpoint', () => {
  assert(/activeTask && isStreaming && \(/.test(chat), 'Stop render missing');
  assert(chat.includes("fetch(`/api/tasks/${activeTask.id}/cancel`, { method: 'POST' })"), 'cancel call missing');
});
check('stream loss tracked honestly', () => {
  assert(chat.includes('source.onerror = () => setStreamLost(true);'), 'onerror missing');
  assert(chat.includes('Live connection interrupted'), 'banner copy missing');
});
check('done handler reads through the ref mirror', () => {
  assert(/splitRuns\(eventsRef\.current\)\.currentRunText/.test(chat), 'ref mirror missing');
});

const work = read('app/work/WorkClient.tsx');
check('work surface reconciles the same way', () => {
  assert(work.includes('isTerminalStatus(serverStatus)'), 'adoption missing');
  assert(work.includes("setStatus(serverStatus as Task['status'])"), 'setStatus missing');
  assert(/if \(demoMode \|\| !isRunning\) return;/.test(work), 'demo guard missing');
  assert(work.includes('if (!sawLiveOutput) router.refresh();'), 'refresh missing');
});

console.log('S3 glyph eradication');
const GLYPHS = [
  '\u2190', '\u2192', '\u2039', '\u203A', '\u25B6', '\u25C6', '\u25C7', '\u25CB',
  '\u25EF', '\u2295', '\u25C8', '\u2318', '\u2715', '\u2713', '\u2726', '\u00D7',
  '\u2717', '\u263C', '\u263E', '\u2317',
];
function* tsxFiles(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* tsxFiles(p);
    else if (entry.name.endsWith('.tsx')) yield p;
  }
}
const offenders = [];
for (const file of [...tsxFiles(path.join(ROOT, 'app')), ...tsxFiles(path.join(ROOT, 'components'))]) {
  const src = fs.readFileSync(file, 'utf8');
  for (const g of GLYPHS) {
    for (const [i, line] of src.split('\n').entries()) {
      if (!line.includes(g)) continue;
      // Documented exemptions:
      //  - components/icons.tsx: the library itself; doc comments name the
      //    unicode glyphs each icon replaces.
      //  - ui.tsx setMod('⌘'): keyboard key LABEL (renders "⌘" on macOS,
      //    "Ctrl" elsewhere) — keyboard semantics, not an icon.
      if (file.endsWith('components/icons.tsx')) continue;
      if (file.endsWith('components/ui.tsx') && line.includes("setMod('")) continue;
      offenders.push(`${path.relative(ROOT, file)}:${i + 1} has ${JSON.stringify(g)}`);
    }
  }
}
check('no unicode icon glyphs in any tsx', () => {
  assert(offenders.length === 0, `${offenders.length} offenders:\n      ${offenders.join('\n      ')}`);
});

console.log('S4 icon library integrity');
const iconSrc = read('components/icons.tsx');
const exported = [...iconSrc.matchAll(/export function (Icon\w+)/g)].map((m) => m[1]);
check('icon set covers the full replaced vocabulary', () => {
  const required = ['IconArrowLeft', 'IconArrowRight', 'IconSearch', 'IconSettings', 'IconCommand',
    'IconPanelLeftClose', 'IconPanelLeftOpen', 'IconMessageCircle', 'IconFolder', 'IconUserRound',
    'IconPlug', 'IconX', 'IconCheck', 'IconChevronRight', 'IconChevronDown',
    'IconDiamond', 'IconSparkles', 'IconSun', 'IconMoon', 'IconMonitor', 'IconPlus', 'IconPlay',
    'IconSquare', 'IconCircle', 'IconHelpCircle', 'IconZap', 'IconTerminal', 'IconArrowUpRight'];
  const missing = required.filter((r) => !exported.includes(r));
  assert(missing.length === 0, `missing: ${missing.join(', ')}`);
});
check('every icon is consumed somewhere in the app', () => {
  const allTsx = [
    ...[...tsxFiles(path.join(ROOT, 'app'))],
    ...[...tsxFiles(path.join(ROOT, 'components'))].filter((p) => !p.endsWith('icons.tsx')),
  ];
  const bodies = allTsx.map((p) => fs.readFileSync(p, 'utf8'));
  const unused = exported.filter((name) => !bodies.some((b) => b.includes(name)));
  assert(unused.length === 0, `unused icons: ${unused.join(', ')}`);
});

console.log(`\n${passed} passed / ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
