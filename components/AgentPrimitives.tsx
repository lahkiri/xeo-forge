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
      <span className="min-w-0 truncate text-[11px] text-gray-500">{label}</span>
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
        'rounded-lg border px-3 py-2.5',
        stalled ? 'border-amber-300/25 bg-amber-300/[0.06]' : 'border-white/[0.07] bg-white/[0.02]',
      )}
      role="status"
      aria-live="polite"
    >
      <div className="flex flex-wrap items-center gap-2">
        <span
          className={cx(
            'h-1.5 w-1.5 shrink-0 rounded-full',
            stalled ? 'bg-amber-300' : 'animate-pulse bg-cyan-300',
          )}
        />
        <span className={cx('text-[12px]', stalled ? 'text-amber-100' : 'text-gray-200')}>{label}</span>
        {elapsed && <span className="text-[11px] tabular-nums text-gray-600">{elapsed}</span>}
      </div>

      {detail && (
        <p className="mt-1 truncate font-mono text-[11px] text-gray-600" title={detail}>
          {detail}
        </p>
      )}

      {stalled && (
        <>
          <p className="mt-1.5 text-[11px] leading-5 text-amber-100/90">
            No new runtime events have arrived. Nothing has been executed during this wait.
          </p>
          {(onRetry || onStop) && (
            <div className="mt-2 flex items-center gap-2">
              {onRetry && (
                <button
                  type="button"
                  onClick={onRetry}
                  className="rounded-md border border-amber-300/30 px-2 py-1 text-[11px] text-amber-100 transition hover:bg-amber-300/10"
                >
                  Retry
                </button>
              )}
              {onStop && (
                <button
                  type="button"
                  onClick={onStop}
                  className="rounded-md border border-white/10 px-2 py-1 text-[11px] text-gray-400 transition hover:bg-white/[0.06]"
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
              'rounded px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-[0.1em] transition',
              onOpen && 'hover:bg-white/[0.07]',
              stage.state === 'current'
                ? 'text-cyan-200'
                : stage.state === 'done'
                  ? 'text-gray-400'
                  : 'text-gray-700',
              !onOpen && 'cursor-default',
            )}
          >
            {stage.label}
          </button>
          {index < stages.length - 1 && (
            <span
              aria-hidden="true"
              className={cx('h-px w-3', stage.state === 'done' ? 'bg-gray-600' : 'bg-white/[0.08]')}
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
    ok: 'bg-emerald-400/80',
    off: 'bg-gray-700',
    unknown: 'bg-amber-300/70',
    bad: 'bg-red-400/80',
  };
  const mark = { ok: '✓', off: '○', unknown: '?', bad: '✕' };

  return (
    <div>
      <p className="mb-2 text-[11px] font-medium text-gray-300">{headline}</p>
      <ul className="space-y-1">
        {signals.map((signal) => (
          <li key={signal.label} className="flex items-center gap-2 text-[11px]" title={signal.detail}>
            <span className={cx('h-1.5 w-1.5 shrink-0 rounded-full', dot[signal.state])} />
            <span className="min-w-0 flex-1 truncate text-gray-500">{signal.label}</span>
            <span
              className={cx(
                'shrink-0 font-mono text-[10px]',
                signal.state === 'ok' ? 'text-emerald-300/80'
                  : signal.state === 'bad' ? 'text-red-300/80'
                  : 'text-gray-600',
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
    good: 'text-emerald-300',
    warn: 'text-amber-300',
    bad: 'text-red-300',
    neutral: 'text-gray-200',
  };

  return (
    <div
      className={cx(
        'rounded-xl border px-4 py-3.5',
        status === 'completed'
          ? 'border-emerald-300/20 bg-emerald-300/[0.05]'
          : 'border-red-400/20 bg-red-400/[0.05]',
      )}
    >
      <p
        className={cx(
          'text-[10px] font-semibold uppercase tracking-[0.18em]',
          status === 'completed' ? 'text-emerald-200/90' : 'text-red-200/90',
        )}
      >
        {status === 'completed' ? 'Completed' : 'Failed'}
      </p>

      {summary && <p className="mt-2 text-[13px] leading-6 text-gray-300">{summary}</p>}

      {facts.length > 0 && (
        <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-3">
          {facts.map((fact) => (
            <div key={fact.label}>
              <dt className="text-[10px] uppercase tracking-[0.12em] text-gray-600">{fact.label}</dt>
              <dd className={cx('mt-0.5 text-[13px] font-semibold tabular-nums', toneText[fact.tone ?? 'neutral'])}>
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
