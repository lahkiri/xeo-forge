'use client';

/**
 * Work governance rail — the right column that answers: what is this run,
 * what may it do, what did it touch, what did it cost.
 *
 * Extracted from WorkClient.tsx (v1.24 structural rework) VERBATIM: same
 * rows, same honesty rules — the repository card renders NOTHING while the
 * workspace is not a repo root, and the not-a-repo answer is stated, never
 * papered over (AGENTS.md §16).
 */

import type { Task, Upload } from '@/lib/types';
import { AuthorityRow, authorityForMode } from '@/components/AgentPrimitives';
import { Badge, Divider, Meter, StatusBadge, cx } from '@/components/ui';
import type { GitStatusSnapshot } from './work-ingest';

/**
 * Product language for the deterministic intent kinds. The DB stores the
 * machine token (conversation / explicit_plan / ...); the UI shows the words
 * a person would use. Same pattern as STATUS_LABEL in ui.tsx — one mapping,
 * every surface.
 */
const INTENT_LABEL: Record<string, string> = {
  conversation: 'ordinary conversation',
  explicit_plan: 'planning requested',
  direct_execution: 'direct execution',
  clarification_needed: 'needs your choice',
};

export function WorkGovernanceRail({
  task,
  status,
  demoMode,
  gitStatus,
  gitStatusLoaded,
  creditsSpent,
  actionCount,
  contextPct,
  contextTokens,
  contextWindow,
  todos,
  filesTouched,
  uploads,
  isTerminal,
  isRunning,
  replan,
}: {
  task: Task;
  status: Task['status'];
  demoMode: boolean;
  gitStatus: GitStatusSnapshot | null;
  gitStatusLoaded: boolean;
  creditsSpent: number;
  actionCount: number;
  contextPct: number | null;
  contextTokens: number;
  contextWindow: number;
  todos: { id: string; description: string; status: string }[];
  filesTouched: string[];
  uploads: Upload[];
  isTerminal: boolean;
  isRunning: boolean;
  /** Full re-plan action from useWorkActions — owns its own toasts + refresh. */
  replan: () => Promise<void>;
}) {
  return (
    <aside className="hidden w-rail shrink-0 flex-col overflow-y-auto border-l border-line-subtle xl:flex">
      <div className="space-y-4 p-3">
        <div>
          <p className="mb-1.5 text-micro font-semibold uppercase tracking-[0.14em] text-content-muted">State</p>
          <div className="flex flex-wrap items-center gap-1.5">
            <StatusBadge status={status} />
            <Badge tone={task.mode === 'build' ? 'violet' : 'amber'}>{task.mode}</Badge>
            {task.intent_kind && <Badge tone="gray">{INTENT_LABEL[task.intent_kind] ?? task.intent_kind}</Badge>}
            {demoMode && (
              <Badge tone="amber">recorded demo</Badge>
            )}
          </div>
        </div>

        <div>
          <p className="mb-1.5 text-micro font-semibold uppercase tracking-[0.14em] text-content-muted">
            Authority
          </p>
          {/* Mirrors what executeTool + authorizeToolCall enforce at dispatch.
              The stored autonomy level shapes these rows live, so the panel
              shows the same policy the executor applies. Each row carries a
              "why" in its title attribute rather than a separate help page. */}
          <div className="space-y-0.5">
            {authorityForMode(task.mode, task.autonomy_level).map((row) => (
              <AuthorityRow key={row.label} label={row.label} state={row.state} reason={row.reason} />
            ))}
            <AuthorityRow
              label="Plan frozen"
              state={task.approved_plan ? 'allowed' : 'locked'}
              reason={
                task.approved_plan
                  ? 'An approved plan was snapshotted and is immutable during this build.'
                  : 'No plan has been approved, so there is no immutable contract yet.'
              }
            />
          </div>
        </div>

        {task.project_path && (
          <div>
            <p className="mb-1.5 text-micro font-semibold uppercase tracking-[0.14em] text-content-muted">
              Boundary
            </p>
            <p className="break-all rounded-control border border-line-subtle bg-black/20 px-2.5 py-2 font-mono text-micro leading-4 text-content-secondary">
              {task.project_path}
            </p>
          </div>
        )}

        {/* Git rail. Renders NOTHING while the workspace is not a repository
            root — an invented "clean" state for a directory with no history
            would be a UI truth violation (AGENTS.md §16). */}
        {gitStatus && (
          <div>
            <p className="mb-1.5 text-micro font-semibold uppercase tracking-[0.14em] text-content-muted">
              Repository
            </p>
            <div className="rounded-control border border-line-subtle bg-black/20 px-2.5 py-2">
              <p className="flex items-center gap-1.5 text-ui text-content-secondary">
                <span className={gitStatus.dirtyCount === 0 ? 'text-signal-pass' : 'text-signal-gate'}>
                  {gitStatus.detached ? 'detached HEAD' : gitStatus.branch ?? 'unborn'}
                </span>
                {gitStatus.dirtyCount > 0 && (
                  <span className="text-micro text-content-muted">
                    · {gitStatus.dirtyCount} change{gitStatus.dirtyCount === 1 ? '' : 's'}
                  </span>
                )}
              </p>
              {gitStatus.lastCommit && (
                <p className="mt-1 truncate font-mono text-micro leading-4 text-content-muted" title={gitStatus.lastCommit.subject}>
                  {gitStatus.lastCommit.hash.slice(0, 7)} {gitStatus.lastCommit.subject}
                </p>
              )}
              <p className="mt-1.5 text-micro leading-4 text-content-faint">
                {gitStatus.staged} staged · {gitStatus.unstaged} unstaged · {gitStatus.untracked} untracked
              </p>
            </div>
          </div>
        )}
        {/* The rail asked and git answered "not a repo here" — say so rather
            than leaving the user wondering whether the rail is broken. */}
        {gitStatusLoaded && !gitStatus && task.project_path && (
          <div>
            <p className="mb-1.5 text-micro font-semibold uppercase tracking-[0.14em] text-content-muted">
              Repository
            </p>
            <p className="rounded-control border border-line-subtle bg-black/20 px-2.5 py-2 text-micro leading-4 text-content-faint">
              Not a git repository root. Parent repositories are deliberately ignored.
            </p>
          </div>
        )}

        <Divider />

        <div className="grid grid-cols-2 gap-2">
          <div className="rounded-control border border-line-subtle bg-black/20 px-2.5 py-2">
            <p className="text-micro uppercase tracking-[0.12em] text-content-muted">Credits</p>
            <p className="mt-0.5 text-base font-semibold tabular-nums text-content-primary">{creditsSpent}</p>
          </div>
          <div className="rounded-control border border-line-subtle bg-black/20 px-2.5 py-2">
            <p className="text-micro uppercase tracking-[0.12em] text-content-muted">Actions</p>
            <p className="mt-0.5 text-base font-semibold tabular-nums text-content-primary">{actionCount}</p>
          </div>
        </div>

        {contextPct !== null && (
          <Meter
            value={contextPct}
            label="Context"
            detail={
              contextWindow > 0
                ? `${contextTokens.toLocaleString()} of ${contextWindow.toLocaleString()} tokens`
                : `${contextTokens.toLocaleString()} tokens`
            }
          />
        )}

        {todos.length > 0 && (
          <div>
            <p className="mb-1.5 text-micro font-semibold uppercase tracking-[0.14em] text-content-muted">
              Checklist
            </p>
            <ul className="space-y-1">
              {todos.map((item) => (
                <li key={item.id} className="flex items-start gap-2 text-meta leading-5">
                  <span
                    className={cx(
                      'mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full',
                      item.status === 'done' ? 'bg-signal-pass/80' : item.status === 'in_progress' ? 'animate-live-pulse bg-signal-run' : 'bg-gray-700',
                    )}
                  />
                  <span className={item.status === 'done' ? 'text-content-muted line-through' : 'text-content-secondary'}>
                    {item.description}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {filesTouched.length > 0 && (
          <div>
            <p className="mb-1.5 text-micro font-semibold uppercase tracking-[0.14em] text-content-muted">
              Files changed ({filesTouched.length})
            </p>
            <ul className="space-y-0.5">
              {filesTouched.map((path) => (
                <li key={path} className="truncate font-mono text-micro leading-5 text-signal-gate/80" title={path}>
                  {path}
                </li>
              ))}
            </ul>
          </div>
        )}

        {uploads.length > 0 && (
          <div>
            <p className="mb-1.5 text-micro font-semibold uppercase tracking-[0.14em] text-content-muted">
              Uploads
            </p>
            <ul className="space-y-0.5">
              {uploads.map((upload) => (
                <li key={upload.id} className="flex items-center justify-between gap-2 text-micro leading-5">
                  <span className="truncate font-mono text-content-muted">{upload.filename}</span>
                  <Badge tone={upload.status === 'ready' ? 'emerald' : upload.status === 'rejected' ? 'red' : 'gray'}>
                    {upload.status}
                  </Badge>
                </li>
              ))}
            </ul>
          </div>
        )}

        <Divider />

        <div className="space-y-1.5">
          {isTerminal && (
            <a
              href={`/api/tasks/${task.id}/export`}
              className="block rounded-control border border-line-subtle px-2.5 py-2 text-center text-meta text-content-secondary transition hover:border-line-strong hover:text-content-primary"
            >
              Export audit trail
            </a>
          )}
          {!isRunning && task.mode === 'build' && (
            <button
              type="button"
              onClick={() => void replan()}
              className="w-full rounded-control border border-line-subtle px-2.5 py-2 text-meta text-content-secondary transition hover:border-line-strong hover:text-content-primary"
            >
              Re-plan this task
            </button>
          )}
        </div>
      </div>
    </aside>
  );
}
