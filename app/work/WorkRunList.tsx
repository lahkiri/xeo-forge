'use client';

/**
 * Work run list — the left rail of recent runs.
 *
 * Extracted from WorkClient.tsx (v1.24 structural rework) VERBATIM.
 */

import Link from 'next/link';
import { IconButton, PanelHeader, StatusBadge, cx } from '@/components/ui';
import { IconArrowLeft, IconPlus } from '@/components/icons';
import { displaySessionLabel } from '@/lib/agent/session-title';

export function WorkRunList({
  runs,
  activeTaskId,
}: {
  runs: { id: string; goal: string; title?: string | null; status: string; mode: string }[];
  activeTaskId: string;
}) {
  return (
    <aside className="hidden w-56 shrink-0 flex-col border-r border-line-subtle 2xl:flex">
      <div className="flex items-center justify-between px-3 pt-3">
        <Link href="/chat" className="inline-flex items-center gap-1.5 text-micro font-semibold uppercase tracking-[0.16em] text-content-muted hover:text-content-primary">
          <IconArrowLeft size={12} /> Workspace
        </Link>
      </div>
      <PanelHeader title="Work">
        <Link href="/work">
          <IconButton label="New work" size="sm">
            <span aria-hidden="true" className="inline-flex leading-none"><IconPlus size={13} /></span>
          </IconButton>
        </Link>
      </PanelHeader>
      <div className="min-h-0 flex-1 overflow-y-auto p-1.5">
        {runs.map((run) => (
          <Link
            key={run.id}
            href={`/work/${run.id}`}
            className={cx(
              'mb-0.5 block rounded-control px-2.5 py-2 transition',
              run.id === activeTaskId
                ? 'bg-ink-600 text-content-primary'
                : 'text-content-muted hover:bg-ink-700 hover:text-content-secondary',
            )}
          >
            {/* v1.25: stored session title, bidi-safe fallback for legacy rows. */}
            <span className="block truncate text-ui leading-5">{displaySessionLabel(run.title, run.goal)}</span>
            <StatusBadge status={run.status} className="mt-1" />
          </Link>
        ))}
      </div>
    </aside>
  );
}
