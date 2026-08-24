'use client';

import { Badge, Meter, cx, type BadgeTone } from './ui';

/* ------------------------------------------------------------------ */
/*  SEMANTIC DOMAIN PRIMITIVES                                         */
/*                                                                     */
/*  These components understand the Xeo domain rather than being        */
/*  generic UI. Every one of them renders ONLY from real backend state  */
/*  passed in as props — none of them infer, estimate, or decorate.     */
/*                                                                     */
/*  RULE: if the backend cannot supply a value, the component renders   */
/*  nothing rather than a placeholder. The UI must never imply a        */
/*  capability or a result that does not exist.                        */
/* ------------------------------------------------------------------ */

/* ── Authority ─────────────────────────────────────────────────────
   Mode determines tool access at dispatch (AGENTS.md §8). This renders
   that fact; it is NOT a policy engine and must not be read as one. */

export type AuthorityState = 'allowed' | 'locked' | 'gated';

const AUTHORITY_TONE: Record<AuthorityState, BadgeTone> = {
  allowed: 'emerald',
  locked: 'gray',
  gated: 'amber',
};

const AUTHORITY_LABEL: Record<AuthorityState, string> = {
  allowed: 'allowed',
  locked: 'locked',
  gated: 'needs approval',
};

export function AuthorityRow({
  label,
  state,
  reason,
}: {
  label: string;
  state: AuthorityState;
  /** Why this state applies. Shown on hover so "Why?" is always answerable. */
  reason: string;
}) {
  return (
    <div className="flex items-center justify-between gap-2 py-0.5" title={reason}>
      <span className="min-w-0 truncate text-meta text-content-muted">{label}</span>
      <Badge tone={AUTHORITY_TONE[state]}>{AUTHORITY_LABEL[state]}</Badge>
    </div>
  );
}

/**
 * Derive the capability view from task mode.
 *
 * This mirrors what `executeTool` enforces: planning mode hard-locks write
 * tools at dispatch. Browser interaction is separately policy-gated, so it is
 * reported as `gated` rather than allowed even in build mode.
 */
export function authorityForMode(mode: string): { label: string; state: AuthorityState; reason: string }[] {
  const build = mode === 'build';
  return [
    {
      label: 'Read files',
      state: 'allowed',
      reason: 'Read access is available in every mode, confined to the task workspace.',
    },
    {
      label: 'Write files',
      state: build ? 'allowed' : 'locked',
      reason: build
        ? 'Build mode executes an approved plan, so write tools are available.'
        : 'Write tools are hard-locked at dispatch until you approve a plan.',
    },
    {
      label: 'Run commands',
      state: build ? 'allowed' : 'locked',
      reason: build
        ? 'Restricted host execution inside the task workspace: env whitelist, path boundaries, command blocklist.'
        : 'Command execution is hard-locked at dispatch until you approve a plan.',
    },
    {
      label: 'Browser actions',
      state: 'gated',
      reason: 'Browser inspection is read-only by default. Interaction requires an explicit policy grant.',
    },
  ];
}

/* ── Runtime banner ───────────────────────────────────────────────── */

/**
 * Current operation, elapsed time, and — when the provider goes quiet — an
 * honest statement that nothing is running. This replaces an animated spinner
 * that implied progress during silence.
 */
export function RuntimeBanner({
  label,
  detail,
  elapsed,
  stalled,
  onRetry,
  onStop,
}: {
  label: string;
  detail?: string;
  elapsed?: string;
  stalled: boolean;
  onRetry?: () => void;
  onStop?: () => void;
}) {
  return (
    <div
      className={cx(
        'rounded-control border px-3 py-2.5',
        stalled ? 'border-signal-gate/25 bg-signal-gate/06' : 'border-line-subtle bg-ink-700/60',
      )}
      role="status"
      aria-live="polite"
    >
      <div className="flex flex-wrap items-center gap-2">
        <span
          className={cx(
            'h-1.5 w-1.5 shrink-0 rounded-full',
            stalled ? 'bg-amber-300' : 'animate-live-pulse bg-signal-run',
          )}
        />
        <span className={cx('text-ui', stalled ? 'text-signal-gate' : 'text-content-primary')}>{label}</span>
        {elapsed && <span className="text-meta tabular-nums text-content-muted">{elapsed}</span>}
      </div>

      {detail && (
        <p className="mt-1 truncate font-mono text-meta text-content-muted" title={detail}>
          {detail}
        </p>
      )}

      {stalled && (
        <>
          <p className="mt-1.5 text-meta leading-5 text-signal-gate/90">
            No new runtime events have arrived. Nothing has been executed during this wait.
          </p>
          {(onRetry || onStop) && (
            <div className="mt-2 flex items-center gap-2">
              {onRetry && (
                <button
                  type="button"
                  onClick={onRetry}
                  className="rounded-md border border-signal-gate/30 px-2 py-1 text-meta text-signal-gate transition hover:bg-signal-gate/10"
                >
                  Retry
                </button>
              )}
              {onStop && (
                <button
                  type="button"
                  onClick={onStop}
                  className="rounded-md border border-line px-2 py-1 text-meta text-content-secondary transition hover:bg-ink-700"
                >
                  Stop
                </button>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}

/* ── Xeo Flow ─────────────────────────────────────────────────────── */

export type FlowStage = 'context' | 'plan' | 'approval' | 'execute' | 'result';

export interface FlowStageState {
  id: FlowStage;
  label: string;
  /** done = observed in the event stream; current = happening now; pending = not yet. */
  state: 'done' | 'current' | 'pending';
  /** Which surface this stage opens. */
  target?: string;
}

/**
 * A compact, clickable stage trail. Each stage is derived from real events or
 * task state — never from a step counter — and navigates to the surface that
 * explains it. It is not a decorative stepper.
 */
export function XeoFlow({
  stages,
  onOpen,
}: {
  stages: FlowStageState[];
  onOpen?: (stage: FlowStage) => void;
}) {
  return (
    <nav aria-label="Run progress" className="flex items-center gap-1">
      {stages.map((stage, index) => (
        <div key={stage.id} className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => onOpen?.(stage.id)}
            disabled={!onOpen}
            title={stage.target ? `Open ${stage.target}` : undefined}
            className={cx(
              'rounded px-1.5 py-0.5 text-micro font-medium uppercase tracking-[0.1em] transition',
              onOpen && 'hover:bg-ink-600',
              stage.state === 'current'
                ? 'text-signal-run'
                : stage.state === 'done'
                  ? 'text-content-secondary'
                  : 'text-content-faint',
              !onOpen && 'cursor-default',
            )}
          >
            {stage.label}
          </button>
          {index < stages.length - 1 && (
            <span
              aria-hidden="true"
              className={cx('h-px w-3', stage.state === 'done' ? 'bg-gray-600' : 'bg-ink-600')}
            />
          )}
        </div>
      ))}
    </nav>
  );
}

/**
 * Derive the flow from observable state only.
 *
 * `context` is done once a context event has been seen; `plan` once a plan
 * exists; `approval` once a plan was frozen into approved_plan; `execute` once
 * a tool has run; `result` on a terminal status. Nothing is guessed.
 */
export function deriveFlow(input: {
  status: string;
  mode: string;
  hasContextEvent: boolean;
  hasPlan: boolean;
  hasApprovedPlan: boolean;
  hasToolActivity: boolean;
}): FlowStageState[] {
  const terminal = input.status === 'completed' || input.status === 'failed';

  const stage = (
    id: FlowStage,
    label: string,
    done: boolean,
    current: boolean,
    target: string,
  ): FlowStageState => ({
    id,
    label,
    state: done ? 'done' : current ? 'current' : 'pending',
    target,
  });

  const contextDone = input.hasContextEvent;
  const planDone = input.hasPlan || input.hasApprovedPlan;
  const approvalDone = input.hasApprovedPlan;
  const executeDone = terminal && input.hasToolActivity;

  return [
    stage('context', 'Context', contextDone, !contextDone && !terminal, 'the Context inspector'),
    stage('plan', 'Plan', planDone, contextDone && !planDone && !terminal, 'the plan'),
    stage(
      'approval',
      'Approval',
      approvalDone,
      planDone && !approvalDone && input.status === 'planned',
      'the approval gate',
    ),
    stage(
      'execute',
      'Execute',
      executeDone,
      !terminal && input.hasToolActivity,
      'the activity timeline',
    ),
    stage('result', 'Result', terminal, false, 'the result'),
  ];
}

/* ── Current truth ────────────────────────────────────────────────── */

export interface SystemSignal {
  label: string;
  state: 'ok' | 'off' | 'unknown' | 'bad';
  detail?: string;
}

/**
 * A compact system-status surface. Every signal must come from a real probe;
 * `unknown` is a valid and honest state, and is preferred over showing a green
 * check we cannot justify.
 */
export function CurrentTruth({ headline, signals }: { headline: string; signals: SystemSignal[] }) {
  const dot = {
    ok: 'bg-signal-pass/80',
    off: 'bg-gray-700',
    unknown: 'bg-signal-gate/70',
    bad: 'bg-signal-fail/80',
  };
  const mark = { ok: '✓', off: '○', unknown: '?', bad: '✕' };

  return (
    <div>
      <p className="mb-2 text-meta font-medium text-content-secondary">{headline}</p>
      <ul className="space-y-1">
        {signals.map((signal) => (
          <li key={signal.label} className="flex items-center gap-2 text-meta" title={signal.detail}>
            <span className={cx('h-1.5 w-1.5 shrink-0 rounded-full', dot[signal.state])} />
            <span className="min-w-0 flex-1 truncate text-content-muted">{signal.label}</span>
            <span
              className={cx(
                'shrink-0 font-mono text-micro',
                signal.state === 'ok' ? 'text-signal-pass/80'
                  : signal.state === 'bad' ? 'text-signal-fail/80'
                  : 'text-content-muted',
              )}
            >
              {mark[signal.state]}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/* ── Context budget ───────────────────────────────────────────────── */

/**
 * Context usage with the platform-policy share separated from user context.
 * Both numbers come from the resolver's token accounting.
 */
export function ContextBudget({
  usedTokens,
  contextWindow,
  percentage,
}: {
  usedTokens?: number;
  contextWindow?: number;
  percentage?: number;
}) {
  if (percentage === undefined && usedTokens === undefined) return null;

  const detail =
    usedTokens !== undefined && contextWindow
      ? `${usedTokens.toLocaleString()} of ${contextWindow.toLocaleString()} tokens`
      : usedTokens !== undefined
        ? `${usedTokens.toLocaleString()} tokens`
        : undefined;

  // Prefer the server's percentage; only derive it when absent and both
  // operands exist, so the bar never shows an invented number.
  const value =
    percentage ??
    (usedTokens !== undefined && contextWindow ? (usedTokens / contextWindow) * 100 : 0);

  return <Meter value={value} label="Context window" detail={detail} />;
}

/* ── Artifact result ──────────────────────────────────────────────── */

export interface ResultFact {
  label: string;
  value: string;
  tone?: 'good' | 'warn' | 'bad' | 'neutral';
}

/**
 * The end of a run as an artifact rather than the word "Done".
 *
 * Facts are supplied by the caller from observed evidence. This component does
 * NOT claim verification — if no verification event occurred, the caller must
 * not pass a verification fact.
 */
export function ResultArtifact({
  status,
  summary,
  facts,
  actions,
}: {
  status: 'completed' | 'failed';
  summary?: string;
  facts: ResultFact[];
  actions?: React.ReactNode;
}) {
  const toneText = {
    good: 'text-signal-pass',
    warn: 'text-amber-300',
    bad: 'text-signal-fail',
    neutral: 'text-content-primary',
  };

  return (
    <div
      className={cx(
        'rounded-panel border px-4 py-3.5',
        status === 'completed'
          ? 'border-signal-pass/20 bg-signal-pass/05'
          : 'border-signal-fail/20 bg-signal-fail/05',
      )}
    >
      <p
        className={cx(
          'text-micro font-semibold uppercase tracking-[0.18em]',
          status === 'completed' ? 'text-signal-pass/90' : 'text-signal-fail/90',
        )}
      >
        {status === 'completed' ? 'Completed' : 'Failed'}
      </p>

      {summary && <p className="mt-2 text-body leading-6 text-content-secondary">{summary}</p>}

      {facts.length > 0 && (
        <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-3">
          {facts.map((fact) => (
            <div key={fact.label}>
              <dt className="text-micro uppercase tracking-[0.12em] text-content-muted">{fact.label}</dt>
              <dd className={cx('mt-0.5 text-body font-semibold tabular-nums', toneText[fact.tone ?? 'neutral'])}>
                {fact.value}
              </dd>
            </div>
          ))}
        </dl>
      )}

      {actions && <div className="mt-3.5 flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}
