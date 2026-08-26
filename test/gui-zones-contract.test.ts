/**
 * Zone-based governance for physical acts (v1.21) — the attack-response tests.
 *
 * The attack: our rules are name-based; a physical act ("click 450,220") has
 * no name to match, so action-based governance collapses on GUI. The answer
 * under test here: classification at DESIGN time into structural zones, then
 * the SAME rule engine governs — plus fail-closed behavior when governance
 * itself is broken.
 *
 * These encode the three invariants the attacker demanded:
 * 1. Irreversible asks at EVERY autonomy level including autonomous.
 * 2. App-touching asks once per app per session shape (ask effect), never
 *    blanket-allowed — avoiding Operator's approval-fatigue trap without
 *    surrendering authority.
 * 3. Broken governance = refusal, never silent passthrough (fail-closed).
 */
import { describe, it, expect } from 'vitest';
import {
  evaluateGuiAct,
  effectiveGuiRules,
  guiResource,
  AUTONOMY_LEVELS,
} from '../lib/agent/permissions';

describe('zone classification — observation is free everywhere', () => {
  it('never asks for free_read acts, at any level', () => {
    for (const level of AUTONOMY_LEVELS) {
      const rules = effectiveGuiRules(level);
      const verdict = evaluateGuiAct(rules, 'free_read', 'screenshot');
      expect(verdict.allowed).toBe(true);
      if (verdict.allowed) expect(verdict.decision.effect).toBe('allow');
    }
  });
});

describe('zone classification — workspace follows autonomy', () => {
  it('denies workspace acts at read_only', () => {
    const verdict = evaluateGuiAct(effectiveGuiRules('read_only'), 'workspace');
    expect(verdict.allowed).toBe(true);
    if (verdict.allowed) expect(verdict.decision.effect).toBe('deny');
  });

  it('allows workspace acts at execute and autonomous', () => {
    for (const level of ['execute', 'autonomous'] as const) {
      const verdict = evaluateGuiAct(effectiveGuiRules(level), 'workspace');
      expect(verdict.allowed).toBe(true);
      if (verdict.allowed) expect(verdict.decision.effect).toBe('allow');
    }
  });

  it('asks for workspace acts at assist', () => {
    const verdict = evaluateGuiAct(effectiveGuiRules('assist'), 'workspace');
    expect(verdict.allowed).toBe(true);
    if (verdict.allowed) expect(verdict.decision.effect).toBe('ask');
  });
});

describe('zone classification — other apps ask, never silently allowed', () => {
  it('asks before touching another application at EVERY level', () => {
    // This is the approval-fatigue counter-design: one ask per app per
    // session is the runtime's job (session cache of granted apps); the
    // RULE layer guarantees it can never be a silent allow.
    for (const level of AUTONOMY_LEVELS) {
      const verdict = evaluateGuiAct(effectiveGuiRules(level), 'app', 'Photoshop');
      expect(verdict.allowed).toBe(true);
      if (verdict.allowed) {
        expect(verdict.decision.effect).toBe('ask');
        expect(verdict.decision.matched?.note ?? '').toContain('app');
      }
    }
  });
});

describe('THE INVARIANT: irreversible asks always, no override can silence it', () => {
  const hostileOverrides = [
    { action: '*' as const, resource: '*' as string, effect: 'allow' as const },
    { action: 'gui' as const, resource: 'zone:*' as string, effect: 'allow' as const },
    { action: 'gui' as const, resource: 'zone:irreversible*' as string, effect: 'allow' as const },
  ];

  it('asks for irreversible acts at every level with NO overrides', () => {
    for (const level of AUTONOMY_LEVELS) {
      const verdict = evaluateGuiAct(effectiveGuiRules(level), 'irreversible', 'Delete project');
      expect(verdict.allowed).toBe(true);
      if (verdict.allowed) expect(verdict.decision.effect).toBe('ask');
    }
  });

  it('still cannot be granted by grant-everything overrides', () => {
    for (const level of AUTONOMY_LEVELS) {
      const rules = effectiveGuiRules(level, hostileOverrides);
      const verdict = evaluateGuiAct(rules, 'irreversible', 'Empty trash');
      expect(verdict.allowed).toBe(true);
      if (verdict.allowed) expect(verdict.decision.effect).toBe('ask');
    }
  });

  it('flags impossible allow-on-irreversible as rule corruption (defense in depth)', () => {
    // Simulate corrupted rules that somehow allow irreversible:
    const corrupted = [{ action: 'gui' as const, resource: 'zone:*' as string, effect: 'allow' as const }];
    // evaluateGuiAct's belt-and-braces check catches this state explicitly.
    const verdict = evaluateGuiAct(corrupted as never, 'irreversible', 'rm');
    // With ONLY corrupted rules present, last-match-wins yields allow —
    // which the belt-and-braces check converts to a governance failure.
    expect(verdict.allowed).toBe(false);
    if (!verdict.allowed && verdict.reason === 'governance_unavailable') {
      expect(verdict.detail).toContain('corruption');
    }
  });
});

describe('FAIL-CLOSED: broken governance refuses loudly', () => {
  it('refuses when no rules were supplied at all', () => {
    const verdict = evaluateGuiAct(undefined, 'workspace');
    expect(verdict.allowed).toBe(false);
    if (!verdict.allowed) {
      expect(verdict.reason).toBe('governance_unavailable');
      expect(verdict.detail).toContain('ungoverned');
    }
  });

  it('refuses when the rules array is empty', () => {
    const verdict = evaluateGuiAct([], 'free_read');
    expect(verdict.allowed).toBe(false);
    if (!verdict.allowed) expect(verdict.reason).toBe('governance_unavailable');
  });

  it('refuses unknown zones — a driver cannot bypass by inventing labels', () => {
    const rules = effectiveGuiRules('execute');
    for (const fake of ['', 'whatever', 'zone:hacked', 'Free_Read']) {
      const verdict = evaluateGuiAct(rules, fake);
      expect(verdict.allowed).toBe(false);
      if (!verdict.allowed) expect(verdict.reason).toBe('unknown_zone');
    }
  });

  it('unknown zone errors tell the driver author exactly what to do', () => {
    const verdict = evaluateGuiAct(effectiveGuiRules('execute'), 'magic');
    expect(verdict.allowed).toBe(false);
    if (!verdict.allowed) {
      expect(verdict.detail).toContain('free_read/workspace/app/irreversible');
    }
  });
});

describe('resource format — detail informs the prompt, never the decision', () => {
  it('zones key decisions; detail only rides along', () => {
    expect(guiResource('app')).toBe('zone:app');
    expect(guiResource('app', 'Terminal')).toBe('zone:app:Terminal');
  });
});
