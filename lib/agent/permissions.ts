/**
 * Declarative permissions (v1.20).
 *
 * Xeo Forge's authority model was scattered across the loop: workspace
 * confinement lived in files.ts, a command denylist lived in code.ts, and
 * "may the agent do this?" was answered by whichever `if` happened to run.
 * Scattered checks are impossible to audit and impossible to show a user.
 *
 * This module makes authority DATA. A rule is
 *   { action, resource, effect }
 * and a decision is a pure function of (rules, action, resource). The rules a
 * run executes under can therefore be persisted with the run, rendered in the
 * UI, diffed between autonomy levels, and tested exhaustively.
 *
 * Design borrowed openly from OpenCode's documented permission model
 * (action/resource/effect with allow|ask|deny and last-match-wins). What is
 * ours: every decision is attributable to the rule that produced it, so the
 * evidence bundle can answer "why was this allowed?" with a citation instead
 * of a shrug.
 */

/** What the agent is trying to do. Extensible: plugins may add actions. */
export type PermissionAction =
  | 'read'
  | 'edit'
  | 'glob'
  | 'grep'
  | 'shell'
  | 'network'
  | 'subagent'
  | 'skill'
  | 'git_mutation'
  | 'external_directory'
  /** v1.21: physical (computer-use) acts, zone-classified at design time. */
  | 'gui';

export type PermissionEffect = 'allow' | 'ask' | 'deny';

export interface PermissionRule {
  action: PermissionAction | '*';
  /** Glob-ish pattern matched against the whole resource value. */
  resource: string;
  effect: PermissionEffect;
  /** Human-readable justification, surfaced in the UI and audit trail. */
  note?: string;
}

export interface PermissionDecision {
  effect: PermissionEffect;
  /** The rule that decided this, or null when nothing matched (defaults to ask). */
  matched: PermissionRule | null;
  /** Index of the matched rule in the evaluated list — stable citation. */
  ruleIndex: number;
  action: PermissionAction;
  resource: string;
}

/**
 * Convert a permission pattern to a RegExp.
 * `*` matches any run of characters (including `/`), `?` matches exactly one.
 * Everything else is literal. Whole-value match, case-insensitive on Windows
 * paths — we normalize case for both sides to keep behavior identical across
 * platforms rather than silently differing by host.
 */
function patternToRegExp(pattern: string): RegExp {
  let out = '';
  for (const char of pattern) {
    if (char === '*') out += '[\\s\\S]*';
    else if (char === '?') out += '[\\s\\S]';
    else out += char.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`^${out}$`, 'i');
}

function normalizeResource(resource: string): string {
  return resource.replace(/\\/g, '/');
}

function ruleMatches(rule: PermissionRule, action: PermissionAction, resource: string): boolean {
  if (rule.action !== '*' && rule.action !== action) return false;
  const value = normalizeResource(resource);
  const pattern = normalizeResource(rule.resource);
  if (patternToRegExp(pattern).test(value)) return true;
  // Shell convenience: "git status *" should also match a bare "git status".
  if (pattern.endsWith(' *')) {
    return patternToRegExp(pattern.slice(0, -2)).test(value);
  }
  return false;
}

/**
 * Evaluate an action against an ordered rule list. LAST match wins, so broad
 * rules go first and exceptions after — the same ordering rule OpenCode
 * documents, chosen because it reads top-to-bottom like a policy document.
 *
 * No match means `ask`: authority is never granted by silence.
 */
export function evaluatePermission(
  rules: readonly PermissionRule[],
  action: PermissionAction,
  resource: string,
): PermissionDecision {
  let decision: PermissionDecision = {
    effect: 'ask',
    matched: null,
    ruleIndex: -1,
    action,
    resource,
  };
  rules.forEach((rule, index) => {
    if (ruleMatches(rule, action, resource)) {
      decision = { effect: rule.effect, matched: rule, ruleIndex: index, action, resource };
    }
  });
  return decision;
}

/**
 * Evaluate several resources for one action (a patch touching many files).
 * Strictest wins: any deny denies, then any ask asks, else allow.
 */
export function evaluatePermissionBatch(
  rules: readonly PermissionRule[],
  action: PermissionAction,
  resources: readonly string[],
): PermissionDecision {
  if (resources.length === 0) return evaluatePermission(rules, action, '');
  const decisions = resources.map((r) => evaluatePermission(rules, action, r));
  return (
    decisions.find((d) => d.effect === 'deny') ??
    decisions.find((d) => d.effect === 'ask') ??
    decisions[0]
  );
}

/* ------------------------------------------------------------------ */
/* Autonomy levels                                                     */
/* ------------------------------------------------------------------ */

/**
 * Autonomy is STATE, not a boolean — the point Malek made and the documented
 * shape of Devin's permission modes and Gemini CLI's plan mode. Each level is
 * a named rule set, so "what can the agent do right now?" has a data answer.
 *
 * The governance thesis holds at every level: raising autonomy changes what
 * happens without asking, never whether it is recorded. Evidence is not a
 * function of the level.
 */
export type AutonomyLevel = 'read_only' | 'assist' | 'execute' | 'autonomous';

const READ_BASE: PermissionRule[] = [
  { action: 'read', resource: '*', effect: 'allow' },
  { action: 'glob', resource: '*', effect: 'allow' },
  { action: 'grep', resource: '*', effect: 'allow' },
  // Secrets are never read silently, at any autonomy level.
  { action: 'read', resource: '*.env', effect: 'ask', note: 'Secret file' },
  { action: 'read', resource: '*.env.*', effect: 'ask', note: 'Secret file' },
  { action: 'read', resource: '*.env.example', effect: 'allow' },
  { action: 'read', resource: '*id_rsa*', effect: 'ask', note: 'Private key' },
  { action: 'read', resource: '*.pem', effect: 'ask', note: 'Private key' },
  // Outside the workspace always asks — confinement is the core contract.
  { action: 'external_directory', resource: '*', effect: 'ask' },
];

/**
 * Commands denied at EVERY level. These are not "risky" — they are
 * unrecoverable or authority-escaping, so no autonomy level grants them
 * silently. Documented in docs/security-model.md alongside the known gaps.
 */
const UNIVERSAL_DENIES: PermissionRule[] = [
  { action: 'shell', resource: '*rm -rf /*', effect: 'deny', note: 'Unrecoverable' },
  { action: 'shell', resource: '*mkfs*', effect: 'deny', note: 'Unrecoverable' },
  { action: 'shell', resource: '*dd if=*of=/dev/*', effect: 'deny', note: 'Unrecoverable' },
  { action: 'shell', resource: '*:(){*', effect: 'deny', note: 'Fork bomb' },
  { action: 'git_mutation', resource: 'push --force*', effect: 'deny', note: 'History rewrite' },
  { action: 'git_mutation', resource: 'reset --hard*', effect: 'ask', note: 'Discards work' },
  { action: 'shell', resource: '*169.254.169.254*', effect: 'deny', note: 'Cloud metadata' },
];

export const AUTONOMY_RULES: Record<AutonomyLevel, PermissionRule[]> = {
  /** Plan mode as a real security boundary, not a prompt request. */
  read_only: [
    ...READ_BASE,
    { action: 'edit', resource: '*', effect: 'deny', note: 'Read-only autonomy' },
    { action: 'shell', resource: '*', effect: 'deny', note: 'Read-only autonomy' },
    { action: 'git_mutation', resource: '*', effect: 'deny', note: 'Read-only autonomy' },
    // web_search is a GET-shaped read of public pages — it mutates nothing,
    // so unlike the network wildcard it is ROUTINE at every level. Listed
    // before the wildcard so the specific rule wins (first-match).
    { action: 'network', resource: 'web_search:*', effect: 'allow', note: 'Reads public pages; mutates nothing' },
    { action: 'network', resource: '*', effect: 'ask' },
    { action: 'subagent', resource: '*', effect: 'deny' },
    ...UNIVERSAL_DENIES,
  ],
  /** Every mutation is confirmed. The safest level that can still change code. */
  assist: [
    ...READ_BASE,
    { action: 'edit', resource: '*', effect: 'ask' },
    { action: 'shell', resource: '*', effect: 'ask' },
    { action: 'git_mutation', resource: '*', effect: 'ask' },
    { action: 'network', resource: 'web_search:*', effect: 'allow', note: 'Reads public pages; mutates nothing' },
    { action: 'network', resource: '*', effect: 'ask' },
    { action: 'subagent', resource: '*', effect: 'ask' },
    { action: 'skill', resource: '*', effect: 'allow' },
    ...UNIVERSAL_DENIES,
  ],
  /**
   * The intended default: routine work proceeds, irreversible or
   * outside-the-workspace work stops for a human. This is the level that
   * answers "don't ask me about everything" without surrendering authority.
   */
  execute: [
    ...READ_BASE,
    { action: 'edit', resource: '*', effect: 'allow' },
    { action: 'shell', resource: '*', effect: 'allow' },
    { action: 'skill', resource: '*', effect: 'allow' },
    { action: 'subagent', resource: '*', effect: 'allow' },
    { action: 'network', resource: '*', effect: 'allow' },
    // Anything that leaves the machine or rewrites shared state still asks.
    // Repo-local staging/navigation is ROUTINE work (v1.21): without explicit
    // allow rules these ops fall through to the silent 'ask' default and would
    // be refused at dispatch — contradicting "routine work proceeds". They stay
    // workspace-bounded like every other local act.
    { action: 'git_mutation', resource: 'push*', effect: 'ask', note: 'Leaves the machine' },
    { action: 'git_mutation', resource: 'commit*', effect: 'allow', note: 'Repo-local, recorded' },
    { action: 'git_mutation', resource: 'add*', effect: 'allow', note: 'Staging is reversible' },
    { action: 'git_mutation', resource: 'checkout*', effect: 'allow', note: 'Branch navigation' },
    { action: 'git_mutation', resource: 'revert*', effect: 'allow', note: 'Adds history; discards nothing' },
    { action: 'shell', resource: '*npm publish*', effect: 'ask', note: 'Publishes a package' },
    { action: 'shell', resource: '*docker push*', effect: 'ask', note: 'Publishes an image' },
    ...UNIVERSAL_DENIES,
  ],
  /**
   * Long-running unattended work. Still not a blank cheque: publishing and
   * history rewrites remain gated, and everything is recorded either way.
   */
  autonomous: [
    ...READ_BASE,
    { action: 'edit', resource: '*', effect: 'allow' },
    { action: 'shell', resource: '*', effect: 'allow' },
    { action: 'skill', resource: '*', effect: 'allow' },
    { action: 'subagent', resource: '*', effect: 'allow' },
    { action: 'network', resource: '*', effect: 'allow' },
    { action: 'git_mutation', resource: '*', effect: 'allow' },
    { action: 'git_mutation', resource: 'push --force*', effect: 'deny' },
    { action: 'shell', resource: '*npm publish*', effect: 'ask', note: 'Publishes a package' },
    ...UNIVERSAL_DENIES,
  ],
};

export const AUTONOMY_LEVELS: readonly AutonomyLevel[] = [
  'read_only',
  'assist',
  'execute',
  'autonomous',
];

export function isAutonomyLevel(value: unknown): value is AutonomyLevel {
  return typeof value === 'string' && (AUTONOMY_LEVELS as readonly string[]).includes(value);
}

/**
 * Validate an autonomy level arriving from an untrusted caller (API body).
 * Returns a discriminated result instead of silently defaulting, so a typo
 * like "autonmous" fails loudly with a list of the valid levels rather than
 * running at whatever level it happened to coerce to. Silent coercion is how
 * "user chose read_only" becomes "ran with full execution authority".
 */
export type AutonomyInputResult =
  | { ok: true; level: AutonomyLevel }
  | { ok: false; reason: string };

export function normalizeAutonomyInput(value: unknown): AutonomyInputResult {
  if (value === undefined || value === null || value === '') {
    return { ok: true, level: 'execute' };
  }
  if (!isAutonomyLevel(value)) {
    return {
      ok: false,
      reason: `Unknown autonomy level "${String(value).slice(0, 40)}". Valid levels are: ${AUTONOMY_LEVELS.join(', ')}.`,
    };
  }
  return { ok: true, level: value };
}

/**
 * Build the effective rule list for a run: the level's rules, then any
 * project/user overrides appended (later rules win). Overrides can tighten
 * or loosen anything EXCEPT the universal denies, which are re-appended last
 * so no configuration can grant them.
 */
export function effectiveRules(
  level: AutonomyLevel,
  overrides: readonly PermissionRule[] = [],
): PermissionRule[] {
  return [...AUTONOMY_RULES[level], ...overrides, ...UNIVERSAL_DENIES];
}

/** Human-facing summary for the UI: what changes at this level. */
export function describeAutonomy(level: AutonomyLevel): {
  title: string;
  detail: string;
  asksAbout: string[];
} {
  switch (level) {
    case 'read_only':
      return {
        title: 'Read-only',
        detail: 'The agent can look and plan. It cannot change or run anything.',
        asksAbout: ['Reading secrets', 'Anything outside the workspace', 'Network access'],
      };
    case 'assist':
      return {
        title: 'Assist',
        detail: 'Every edit and command waits for you.',
        asksAbout: ['Every file edit', 'Every command', 'Every git action'],
      };
    case 'execute':
      return {
        title: 'Execute',
        detail: 'Routine work proceeds. Anything that leaves this machine stops for you.',
        asksAbout: ['git push', 'Publishing packages or images', 'Secrets', 'Outside the workspace'],
      };
    case 'autonomous':
      return {
        title: 'Autonomous',
        detail: 'Long unattended runs. Still recorded, still gated on publishing.',
        asksAbout: ['Publishing packages', 'Secrets', 'Outside the workspace'],
      };
  }
}

/* ------------------------------------------------------------------ */
/* Physical-action zones (v1.21) — governing acts, not names           */
/* ------------------------------------------------------------------ */

/**
 * The attack this layer answers: our rules are name-based ('shell',
 * 'git push *'), but a physical act has no name to match. "Click (450, 220)"
 * is not a string a policy can be written against in advance.
 *
 * The resolution is NOT a parallel system — it is classification at DESIGN
 * time. Every GUI capability a driver exposes is tagged with the structural
 * zone it belongs to; the tag becomes the resource, and the existing
 * rule engine governs it unchanged. Classification lives with the driver
 * author who KNOWS what the act structurally is, not with a text guesser.
 *
 * Zones are ordered by structural reversibility:
 *   free_read     — observing cannot damage anything. Never asks.
 *   workspace     — acts confined to the task workspace. Follows autonomy level.
 *   app           — touching another application. Asks once per app per session,
 *                   not per click: the approval-fatigue trap documented by
 *                   Operator is a governance failure, not user weakness.
 *   irreversible  — structurally unrecoverable (delete, send, install/uninstall,
 *                   system settings). Asks ALWAYS, at every autonomy level,
 *                   including autonomous. No override can silence it.
 */
export type GuiZone = 'free_read' | 'workspace' | 'app' | 'irreversible';

export const GUI_ZONE_ACTION: PermissionAction = 'gui';

/**
 * Build the resource value for a zone-scoped physical act.
 * The `detail` (app name, window title) is informational for the ask prompt;
 * authority decisions key on the ZONE, never on guessed intent from detail.
 */
export function guiResource(zone: GuiZone, detail?: string): string {
  return detail ? `zone:${zone}:${detail}` : `zone:${zone}`;
}

/** Rules every autonomy level carries for physical acts. */
export const GUI_ZONE_RULES: PermissionRule[] = [
  { action: 'gui', resource: 'zone:free_read', effect: 'allow', note: 'Observation cannot damage' },
  { action: 'gui', resource: 'zone:free_read:*', effect: 'allow', note: 'Observation cannot damage' },
  // workspace + app defaults are appended per-level below; irreversible is last.
  { action: 'gui', resource: 'zone:irreversible', effect: 'ask', note: 'Structurally unrecoverable' },
  { action: 'gui', resource: 'zone:irreversible:*', effect: 'ask', note: 'Structurally unrecoverable' },
];

const GUI_LEVEL_DEFAULTS: Record<AutonomyLevel, PermissionRule[]> = {
  read_only: [
    ...GUI_ZONE_RULES.filter((r) => !r.resource.startsWith('zone:irreversible')),
    { action: 'gui', resource: 'zone:workspace', effect: 'deny', note: 'Read-only autonomy' },
    { action: 'gui', resource: 'zone:workspace:*', effect: 'deny', note: 'Read-only autonomy' },
    { action: 'gui', resource: 'zone:app', effect: 'ask', note: 'Another application' },
    { action: 'gui', resource: 'zone:app:*', effect: 'ask', note: 'Another application' },
    ...GUI_ZONE_RULES.filter((r) => r.resource.startsWith('zone:irreversible')),
  ],
  assist: [
    ...GUI_ZONE_RULES.filter((r) => !r.resource.startsWith('zone:irreversible')),
    { action: 'gui', resource: 'zone:workspace', effect: 'ask' },
    { action: 'gui', resource: 'zone:app', effect: 'ask' },
    { action: 'gui', resource: 'zone:app:*', effect: 'ask', note: 'Another application' },
    ...GUI_ZONE_RULES.filter((r) => r.resource.startsWith('zone:irreversible')),
  ],
  execute: [
    ...GUI_ZONE_RULES.filter((r) => !r.resource.startsWith('zone:irreversible')),
    { action: 'gui', resource: 'zone:workspace', effect: 'allow', note: 'Confined to workspace' },
    { action: 'gui', resource: 'zone:workspace:*', effect: 'allow', note: 'Confined to workspace' },
    { action: 'gui', resource: 'zone:app', effect: 'ask', note: 'One ask per app per session' },
    { action: 'gui', resource: 'zone:app:*', effect: 'ask', note: 'Another application' },
    ...GUI_ZONE_RULES.filter((r) => r.resource.startsWith('zone:irreversible')),
  ],
  autonomous: [
    ...GUI_ZONE_RULES.filter((r) => !r.resource.startsWith('zone:irreversible')),
    { action: 'gui', resource: 'zone:workspace', effect: 'allow' },
    { action: 'gui', resource: 'zone:workspace:*', effect: 'allow', note: 'Confined to workspace' },
    { action: 'gui', resource: 'zone:app', effect: 'ask', note: 'Unattended: another app needs consent' },
    { action: 'gui', resource: 'zone:app:*', effect: 'ask', note: 'Another application' },
    ...GUI_ZONE_RULES.filter((r) => r.resource.startsWith('zone:irreversible')),
  ],
};

/**
 * Effective GUI rules for a run: level defaults, then overrides, then the
 * irreversible gate re-appended LAST so no configuration can grant it —
 * the same pattern that protects UNIVERSAL_DENIES.
 */
export function effectiveGuiRules(
  level: AutonomyLevel,
  overrides: readonly PermissionRule[] = [],
): PermissionRule[] {
  return [
    ...GUI_LEVEL_DEFAULTS[level],
    ...overrides,
    { action: 'gui', resource: 'zone:irreversible', effect: 'ask', note: 'Structurally unrecoverable' },
    { action: 'gui', resource: 'zone:irreversible:*', effect: 'ask', note: 'Structurally unrecoverable' },
  ];
}

/**
 * Fail-closed evaluation for physical acts (v1.21).
 *
 * If the GOVERNANCE LAYER ITSELF is broken — empty rule set, unknown zone,
 * classifier missing — the act is DENIED, not waved through. Silent failure
 * is what hands an unattended machine to an attacker; loud failure just
 * costs a retry. There is deliberately NO global kill-switch for this: an
 * escape hatch requires a full, conscious approval of the specific command,
 * which is exactly what a per-run override rule is.
 */
export type FailClosedVerdict =
  | { allowed: false; reason: 'governance_unavailable'; detail: string }
  | { allowed: false; reason: 'unknown_zone'; detail: string }
  | { allowed: true; decision: PermissionDecision };

export function evaluateGuiAct(
  rules: readonly PermissionRule[] | undefined | null,
  zone: string,
  detail?: string,
): FailClosedVerdict {
  if (!rules || rules.length === 0) {
    return {
      allowed: false,
      reason: 'governance_unavailable',
      detail: 'No permission rules were supplied for this run. Refusing to execute a physical act ungoverned.',
    };
  }
  const knownZones: readonly string[] = ['free_read', 'workspace', 'app', 'irreversible'];
  if (!knownZones.includes(zone)) {
    return {
      allowed: false,
      reason: 'unknown_zone',
      detail: `Zone "${zone.slice(0, 40)}" is not a known structural classification. A driver must classify acts into free_read/workspace/app/irreversible.`,
    };
  }
  const resource = guiResource(zone as GuiZone, detail);
  const decision = evaluatePermission(rules, GUI_ZONE_ACTION, resource);
  // Belt and braces: even if a misconfiguration produced allow here, the
  // irreversible gate re-append makes that impossible for zone:irreversible*.
  if (zone === 'irreversible' && decision.effect === 'allow') {
    return {
      allowed: false,
      reason: 'governance_unavailable',
      detail: 'Irreversible acts can never evaluate to allow. This state indicates rule corruption.',
    };
  }
  return { allowed: true, decision };
}
