'use client';

import { useMemo } from 'react';
import { cx, EmptyState } from '@/components/ui';
import { IconArrowRight } from '@/components/icons';
import type { DiffLine, DiffHunk } from '@/lib/diff';
import { parseUnifiedDiff } from '@/lib/diff';

/** Common shape that both FileDiff and ParsedFileDiff satisfy. */
interface DiffFileBase {
  oldPath: string;
  newPath: string;
  hunks: DiffHunk[];
  additions: number;
  deletions: number;
  binary: boolean;
  oldNoEol: boolean;
  newNoEol: boolean;
}

interface DiffViewProps {
  diff?: DiffFileBase;
  unifiedText?: string;
  className?: string;
  showHeader?: boolean;
}

export function DiffView({ diff, unifiedText, className = '', showHeader = true }: DiffViewProps) {
  const files = useMemo(() => {
    if (diff) return [diff];
    if (unifiedText) return parseUnifiedDiff(unifiedText);
    return [];
  }, [diff, unifiedText]);

  if (files.length === 0) {
    return (
      <div className={className}>
        <EmptyState title="No changes" description="There is nothing to diff." />
      </div>
    );
  }

  return (
    <div className={cx('font-mono text-[0.8125rem] leading-5', className)}>
      {files.map((file, fi) => (
        <DiffFile key={fi} file={file} showHeader={showHeader} />
      ))}
    </div>
  );
}

function DiffFile({ file, showHeader }: { file: DiffFileBase; showHeader: boolean }) {
  if (file.binary || (file.hunks.length === 0 && file.additions === 0 && file.deletions === 0)) {
    return (
      <div className="border-b border-line-subtle py-2 px-3">
        {showHeader && (
          <p className="text-content-muted text-micro">
            {file.oldPath} <span className="inline-flex align-middle"><IconArrowRight size={11} /></span> {file.newPath}
          </p>
        )}
        <p className="text-content-muted">{file.binary ? 'Binary files differ' : 'No changes'}</p>
      </div>
    );
  }

  return (
    <div className="border-b border-line-subtle last:border-b-0">
      {showHeader && (
        <div className="flex items-center gap-2 border-b border-line-subtle bg-ink-700/40 px-3 py-1.5">
          <span className="text-content-secondary">{file.oldPath}</span>
          <span className="inline-flex text-content-muted"><IconArrowRight size={11} /></span>
          <span className="text-content-secondary">{file.newPath}</span>
          <span className="ml-auto text-micro tabular-nums">
            <span className="text-[rgb(var(--diff-add))]">+{file.additions}</span>
            {' / '}
            <span className="text-[rgb(var(--diff-del))]">-{file.deletions}</span>
          </span>
        </div>
      )}
      {file.hunks.map((hunk, hi) => (
        <div key={hi}>
          <div className="bg-ink-700/30 px-3 py-0.5 text-content-muted">
            @@ -{hunk.oldStart},{hunk.oldCount} +{hunk.newStart},{hunk.newCount} @@
          </div>
          {hunk.lines.map((line, li) => (
            <DiffLineRow key={li} line={line} />
          ))}
        </div>
      ))}
    </div>
  );
}

function DiffLineRow({ line }: { line: DiffLine }) {
  const isAdd = line.op === 'add';
  const isDel = line.op === 'del';

  const bgClass = isAdd
    ? 'bg-[rgb(var(--diff-add)/0.12)]'
    : isDel
      ? 'bg-[rgb(var(--diff-del)/0.12)]'
      : '';

  const textClass = isAdd
    ? 'text-[rgb(var(--diff-add))]'
    : isDel
      ? 'text-[rgb(var(--diff-del))]'
      : 'text-content-secondary';

  const prefix = isAdd ? '+' : isDel ? '-' : ' ';

  const prefixClass = isAdd
    ? 'text-[rgb(var(--diff-add))]'
    : isDel
      ? 'text-[rgb(var(--diff-del))]'
      : 'text-content-muted';

  const oldNum = line.oldLine !== undefined ? String(line.oldLine) : '';
  const newNum = line.newLine !== undefined ? String(line.newLine) : '';

  return (
    <div className={cx('flex', bgClass)}>
      <span className="w-12 shrink-0 select-none text-right pr-2 text-content-faint">{oldNum}</span>
      <span className="w-12 shrink-0 select-none text-right pr-2 text-content-faint">{newNum}</span>
      <span className={cx('w-5 shrink-0 select-none text-center', prefixClass)}>{prefix}</span>
      <span className={cx('min-w-0 flex-1 whitespace-pre', textClass)}>{line.text}</span>
      {line.noEol && (
        <span className="ml-2 shrink-0 text-content-faint italic">No newline at end of file</span>
      )}
    </div>
  );
}
