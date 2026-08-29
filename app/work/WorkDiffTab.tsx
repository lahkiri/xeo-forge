'use client';

/**
 * Work Diff tab — workspace diff, per-file change list, honest blocked state.
 *
 * Extracted from WorkClient.tsx (v1.24 structural rework) VERBATIM: a click
 * on a Files-changed row scopes the diff to that file; "no changes yet" and
 * "blocked" are distinct honest states.
 */

import { Alert, Button, EmptyState } from '@/components/ui';
import { DiffView } from '@/components/DiffView';
import type { GitStatusSnapshot } from './work-ingest';

export function WorkDiffTab({
  diffText,
  diffBlocked,
  diffLoading,
  onLoadDiff,
  onClearDiff,
  gitStatus,
  fileChanges,
}: {
  diffText: string | null;
  diffBlocked: string | null;
  diffLoading: boolean;
  onLoadDiff: (path?: string) => void;
  onClearDiff: () => void;
  gitStatus: GitStatusSnapshot | null;
  fileChanges: { action: string; path: string }[];
}) {
  return (
    <div className="min-h-0 flex-1 overflow-y-auto p-4">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Button size="sm" variant="secondary" loading={diffLoading} onClick={() => onLoadDiff()}>
          Load workspace diff
        </Button>
        {diffText && (
          <Button size="sm" variant="ghost" onClick={onClearDiff}>
            Clear
          </Button>
        )}
        {gitStatus && (
          <span className="text-micro text-content-muted">
            {gitStatus.detached ? 'detached HEAD' : gitStatus.branch ?? 'unborn'} ·{' '}
            {gitStatus.dirtyCount === 0 ? 'clean' : `${gitStatus.dirtyCount} change${gitStatus.dirtyCount === 1 ? '' : 's'}`}
          </span>
        )}
      </div>
      {diffBlocked && !diffText && (
        <Alert tone="warn" title="No diff available">{diffBlocked}</Alert>
      )}
      {diffText ? (
        <DiffView unifiedText={diffText} />
      ) : fileChanges.length > 0 ? (
        <div className="space-y-1">
          <p className="mb-3 text-micro font-semibold uppercase tracking-[0.14em] text-content-muted">
            Files changed ({fileChanges.length}) — click a file to diff it against the repository
          </p>
          {fileChanges.map((fc, i) => (
            <button
              key={i}
              type="button"
              onClick={() => onLoadDiff(fc.path)}
              disabled={diffLoading}
              className="flex w-full items-center gap-2 rounded-control border border-line-subtle bg-ink-700/40 px-3 py-2 text-left transition hover:border-line-strong disabled:opacity-60"
            >
              <span
                className={
                  fc.action === 'created'
                    ? 'text-signal-pass'
                    : fc.action === 'deleted'
                      ? 'text-signal-fail'
                      : 'text-signal-gate'
                }
              >
                {fc.action === 'created' ? 'A' : fc.action === 'deleted' ? 'D' : 'M'}
              </span>
              <span className="truncate font-mono text-ui text-content-secondary">{fc.path}</span>
            </button>
          ))}
        </div>
      ) : !diffBlocked ? (
        <EmptyState
          icon={<span aria-hidden="true">Diff</span>}
          title="No changes yet"
          description="File changes made by the agent will appear here. When the workspace is a git repository you can also load the full working-tree diff."
        />
      ) : null}
    </div>
  );
}
