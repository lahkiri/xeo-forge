/**
 * Declarative permission contract (v1.20) + autonomy levels.
 *
 * The claim under test: authority is DATA, evaluated identically everywhere,
 * and no autonomy level — nor any user override — can grant the unrecoverable
 * actions. If a future refactor moves a check back into an `if`, these tests
 * are the ones that should fail.
 */
import { describe, it, expect } from 'vitest';
import {
  evaluatePermission,
  evaluatePermissionBatch,
  effectiveRules,
  describeAutonomy,
  isAutonomyLevel,
  AUTONOMY_LEVELS,
  AUTONOMY_RULES,
  type PermissionRule,
} from '../lib/agent/permissions';

describe('evaluatePermission — matching semantics', () => {
  const rules: PermissionRule[] = [
    { action: '*', resource: '*', effect: 'ask' },
    { action: 'read', resource: '*', effect: 'allow' },
    { action: 'read', resource: '*.env', effect: 'deny' },
    { action: 'shell', resource: 'git status *', effect: 'allow' },
  ];

  it('returns ask when nothing matches — authority is never granted by silence', () => {
    const decision = evaluatePermission([], 'edit', 'src/a.ts');
    expect(decision.effect).toBe('ask');
    expect(decision.matched).toBeNull();
  });

  it('lets the LAST matching rule win so exceptions can follow broad rules', () => {
    expect(evaluatePermission(rules, 'read', 'src/a.ts').effect).toBe('allow');
    expect(evaluatePermission(rules, 'read', 'config/.env').effect).toBe('deny');
  });

  it('matches a trailing " *" shell pattern with no arguments too', () => {
    expect(evaluatePermission(rules, 'shell', 'git status').effect).toBe('allow');
    expect(evaluatePermission(rules, 'shell', 'git status --short').effect).toBe('allow');
  });

  it('matches whole values only — a prefix must not leak authority', () => {
    const strict: PermissionRule[] = [{ action: 'shell', resource: 'ls', effect: 'allow' }];
    expect(evaluatePermission(strict, 'shell', 'ls').effect).toBe('allow');
    expect(evaluatePermission(strict, 'shell', 'ls && rm -rf x').effect).toBe('ask');
  });

  it('normalizes Windows separators so one rule covers both platforms', () => {
    const r: PermissionRule[] = [{ action: 'edit', resource: 'src/*', effect: 'allow' }];
    expect(evaluatePermission(r, 'edit', 'src\\deep\\a.ts').effect).toBe('allow');
  });

  it('cites the rule index that decided, so the audit trail can point at it', () => {
    const decision = evaluatePermission(rules, 'read', 'x/.env');
    expect(decision.ruleIndex).toBe(2);
    expect(decision.matched?.effect).toBe('deny');
  });

  it('treats regex metacharacters in resources as literals', () => {
    const r: PermissionRule[] = [{ action: 'read', resource: 'a+b(c).ts', effect: 'allow' }];
    expect(evaluatePermission(r, 'read', 'a+b(c).ts').effect).toBe('allow');
    expect(evaluatePermission(r, 'read', 'aaab c .ts').effect).toBe('ask');
  });
});

describe('evaluatePermissionBatch — strictest wins', () => {
  const rules: PermissionRule[] = [
    { action: 'edit', resource: '*', effect: 'allow' },
    { action: 'edit', resource: '*.lock', effect: 'ask' },
    { action: 'edit', resource: 'vendor/*', effect: 'deny' },
  ];

  it('denies a multi-file patch if any single file is denied', () => {
    expect(evaluatePermissionBatch(rules, 'edit', ['a.ts', 'vendor/x.ts']).effect).toBe('deny');
  });

  it('asks when a file needs asking and none are denied', () => {
    expect(evaluatePermissionBatch(rules, 'edit', ['a.ts', 'yarn.lock']).effect).toBe('ask');
  });

  it('allows only when every file is allowed', () => {
    expect(evaluatePermissionBatch(rules, 'edit', ['a.ts', 'b.ts']).effect).toBe('allow');
  });
});

describe('autonomy levels — state, not a boolean', () => {
  it('exposes exactly the four documented levels', () => {
    expect([...AUTONOMY_LEVELS]).toEqual(['read_only', 'assist', 'execute', 'autonomous']);
    for (const level of AUTONOMY_LEVELS) expect(isAutonomyLevel(level)).toBe(true);
    expect(isAutonomyLevel('yolo')).toBe(false);
  });

  it('makes read_only a real boundary: edits and shell are denied, not discouraged', () => {
    const rules = effectiveRules('read_only');
    expect(evaluatePermission(rules, 'edit', 'src/a.ts').effect).toBe('deny');
    expect(evaluatePermission(rules, 'shell', 'npm test').effect).toBe('deny');
    expect(evaluatePermission(rules, 'read', 'src/a.ts').effect).toBe('allow');
  });

  it('asks for every mutation at assist', () => {
    const rules = effectiveRules('assist');
    expect(evaluatePermission(rules, 'edit', 'src/a.ts').effect).toBe('ask');
    expect(evaluatePermission(rules, 'shell', 'npm test').effect).toBe('ask');
  });

  it('lets routine work through at execute but stops what leaves the machine', () => {
    const rules = effectiveRules('execute');
    expect(evaluatePermission(rules, 'edit', 'src/a.ts').effect).toBe('allow');
    expect(evaluatePermission(rules, 'shell', 'npm test').effect).toBe('allow');
    expect(evaluatePermission(rules, 'git_mutation', 'commit -m x').effect).toBe('allow');
    expect(evaluatePermission(rules, 'git_mutation', 'push origin main').effect).toBe('ask');
    expect(evaluatePermission(rules, 'shell', 'npm publish --access public').effect).toBe('ask');
  });

  it('keeps publishing gated even at the highest autonomy', () => {
    const rules = effectiveRules('autonomous');
    expect(evaluatePermission(rules, 'git_mutation', 'push origin main').effect).toBe('allow');
    expect(evaluatePermission(rules, 'shell', 'npm publish').effect).toBe('ask');
    expect(evaluatePermission(rules, 'git_mutation', 'push --force origin main').effect).toBe('deny');
  });

  it('asks about secrets at EVERY level — no level reads .env silently', () => {
    for (const level of AUTONOMY_LEVELS) {
      const rules = effectiveRules(level);
      expect(evaluatePermission(rules, 'read', '.env').effect).toBe('ask');
      expect(evaluatePermission(rules, 'read', 'app/.env.production').effect).toBe('ask');
      // The example file is documentation, not a secret.
      expect(evaluatePermission(rules, 'read', '.env.example').effect).toBe('allow');
    }
  });

  it('asks before leaving the workspace at EVERY level', () => {
    for (const level of AUTONOMY_LEVELS) {
      const decision = evaluatePermission(effectiveRules(level), 'external_directory', '/etc/*');
      expect(decision.effect).toBe('ask');
    }
  });
});

describe('universal denies cannot be granted by configuration', () => {
  const grantEverything: PermissionRule[] = [{ action: '*', resource: '*', effect: 'allow' }];

  it('keeps unrecoverable commands denied even when an override allows all', () => {
    for (const level of AUTONOMY_LEVELS) {
      const rules = effectiveRules(level, grantEverything);
      expect(evaluatePermission(rules, 'shell', 'rm -rf /').effect).toBe('deny');
      expect(evaluatePermission(rules, 'shell', 'sudo mkfs.ext4 /dev/sda').effect).toBe('deny');
      expect(evaluatePermission(rules, 'git_mutation', 'push --force origin main').effect).toBe('deny');
    }
  });

  it('keeps the cloud metadata endpoint denied at every level', () => {
    for (const level of AUTONOMY_LEVELS) {
      const rules = effectiveRules(level, grantEverything);
      expect(evaluatePermission(rules, 'shell', 'curl http://169.254.169.254/latest/meta-data/').effect).toBe(
        'deny',
      );
    }
  });

  it('still lets an override loosen a NON-universal rule', () => {
    const rules = effectiveRules('assist', [{ action: 'edit', resource: 'docs/*', effect: 'allow' }]);
    expect(evaluatePermission(rules, 'edit', 'docs/readme.md').effect).toBe('allow');
    expect(evaluatePermission(rules, 'edit', 'src/a.ts').effect).toBe('ask');
  });
});

describe('describeAutonomy — every level is explainable to a human', () => {
  it('returns a title, detail and non-empty ask list for each level', () => {
    for (const level of AUTONOMY_LEVELS) {
      const described = describeAutonomy(level);
      expect(described.title.length).toBeGreaterThan(0);
      expect(described.detail.length).toBeGreaterThan(0);
      expect(described.asksAbout.length).toBeGreaterThan(0);
    }
  });

  it('has a rule set defined for every declared level', () => {
    for (const level of AUTONOMY_LEVELS) {
      expect(AUTONOMY_RULES[level].length).toBeGreaterThan(0);
    }
  });
});
