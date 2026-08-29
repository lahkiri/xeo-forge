import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

/**
 * Settings visibility for governance features (desktop-parity batch, Phase 5).
 *
 * Sandbox tiers and subagent delegation shipped in v1.23 with NO Settings
 * section — both were reachable only inside the "New work session" form.
 * Phase 5 fixes the gap and adds the standing rule to AGENTS.md §17: any
 * governance-critical feature ships with a visible Settings section from
 * day one.
 */

const REPO_ROOT = path.resolve(__dirname, '..');
const readSrc = (rel: string) => fs.readFileSync(path.join(REPO_ROOT, rel), 'utf8');

describe('settings nav carries the governance sections', () => {
  it('registers Sandbox and Subagents sections', () => {
    const layout = readSrc('app/settings/SettingsLayout.tsx');
    expect(layout).toMatch(/'\/settings\/sandbox', label: 'Sandbox'/);
    expect(layout).toMatch(/'\/settings\/subagents', label: 'Subagents'/);
  });

  it('both pages exist', () => {
    expect(fs.existsSync(path.join(REPO_ROOT, 'app/settings/sandbox/page.tsx'))).toBe(true);
    expect(fs.existsSync(path.join(REPO_ROOT, 'app/settings/subagents/page.tsx'))).toBe(true);
  });
});

describe('Sandbox section renders the executor’s own tier data', () => {
  it('feeds from /api/sandbox (the shared SANDBOX_MODES + real docker probe), not a copy', () => {
    const settings = readSrc('app/settings/SandboxSettings.tsx');
    expect(settings).toMatch(/fetch\('\/api\/sandbox'/);
    // The API returns the executor's own SANDBOX_MODES — never a UI twin.
    expect(readSrc('app/api/sandbox/route.ts')).toMatch(/modes: SANDBOX_MODES/);
    expect(readSrc('app/api/sandbox/route.ts')).toMatch(/detectDocker/);
  });

  it('renders tier descriptions verbatim with the live Docker status chip', () => {
    const settings = readSrc('app/settings/SandboxSettings.tsx');
    expect(settings).toMatch(/mode\.describe/);
    expect(settings).toMatch(/Docker connected|Docker not detected/);
  });
});

describe('Subagents section discloses the honest boundary', () => {
  it('states inheritance, read-only construction, attribution, and the write gap', () => {
    const settings = readSrc('app/settings/SubagentsSettings.tsx');
    expect(settings).toMatch(/read-only by construction/);
    expect(settings).toMatch(/PARENT task/);
    expect(settings).toMatch(/sub-N attribution/);
    expect(settings).toMatch(/waits for a proven concurrent-write design/);
  });
});

describe('the standing rule lives in AGENTS.md', () => {
  it('section 17 forbids burying governance features in task-start forms only', () => {
    const agents = readSrc('AGENTS.md');
    expect(agents).toMatch(/## 17\. Settings visibility rule/);
    expect(agents).toMatch(/must ship with a\s+visible Settings section from day one/);
    expect(agents).toMatch(/never ONLY there/);
  });
});
