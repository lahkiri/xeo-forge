'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Badge, KeyHint, cx, useModKey } from './ui';

/* ------------------------------------------------------------------ */
/*  Keyboard layer. The reason a user can close the terminal: every    */
/*  surface is reachable without the mouse.                            */
/* ------------------------------------------------------------------ */

export interface Command {
  id: string;
  label: string;
  hint?: string;
  group: string;
  keys?: string[];
  run: () => void;
}

/** True when focus is in a text entry, so global single-key hotkeys must not fire. */
export function isTypingTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable;
}

/**
 * Register global hotkeys. Combos with a modifier fire anywhere; bare keys are
 * suppressed while typing so they never eat composer input.
 */
export function useHotkeys(
  bindings: { combo: string; run: (event: KeyboardEvent) => void; allowInInput?: boolean }[],
  enabled = true,
) {
  const ref = useRef(bindings);
  ref.current = bindings;

  useEffect(() => {
    if (!enabled) return;
    const onKey = (event: KeyboardEvent) => {
      const mod = event.metaKey || event.ctrlKey;
      const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;
      const combo = [mod && 'mod', event.shiftKey && 'shift', event.altKey && 'alt', key]
        .filter(Boolean)
        .join('+');

      for (const binding of ref.current) {
        if (binding.combo !== combo) continue;
        const bare = !binding.combo.includes('mod');
        if (bare && !binding.allowInInput && isTypingTarget(event.target)) continue;
        event.preventDefault();
        binding.run(event);
        return;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [enabled]);
}

/* ── Command palette ──────────────────────────────────────────────── */

function scoreCommand(command: Command, query: string): number {
  if (!query) return 1;
  const haystack = `${command.label} ${command.hint ?? ''} ${command.group}`.toLowerCase();
  const needle = query.toLowerCase();
  if (haystack.includes(needle)) return 100 - haystack.indexOf(needle);
  // Subsequence match so "nw" finds "New Work".
  let index = 0;
  for (const ch of needle) {
    index = haystack.indexOf(ch, index);
    if (index === -1) return 0;
    index += 1;
  }
  return 1;
}

export function CommandPalette({
  open,
  onClose,
  commands,
}: {
  open: boolean;
  onClose: () => void;
  commands: Command[];
}) {
  const [query, setQuery] = useState('');
  const [cursor, setCursor] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const matches = useMemo(() => {
    return commands
      .map((command) => ({ command, score: scoreCommand(command, query) }))
      .filter((entry) => entry.score > 0)
      .sort((a, b) => b.score - a.score)
      .map((entry) => entry.command);
  }, [commands, query]);

  useEffect(() => {
    if (open) {
      setQuery('');
      setCursor(0);
      // Focus after paint so the dialog is mounted.
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  useEffect(() => {
    setCursor(0);
  }, [query]);

  useEffect(() => {
    listRef.current?.querySelector('[data-active="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [cursor]);

  if (!open) return null;

  const commit = (command: Command | undefined) => {
    if (!command) return;
    onClose();
    command.run();
  };

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      onClose();
    } else if (event.key === 'ArrowDown') {
      event.preventDefault();
      setCursor((c) => (matches.length === 0 ? 0 : (c + 1) % matches.length));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setCursor((c) => (matches.length === 0 ? 0 : (c - 1 + matches.length) % matches.length));
    } else if (event.key === 'Enter') {
      event.preventDefault();
      commit(matches[cursor]);
    }
  };

  // Group headers, preserving match order.
  const seenGroups = new Set<string>();

  return (
    <div className="fixed inset-0 z-[70] flex items-start justify-center p-4 pt-[12vh]">
      <button
        type="button"
        aria-label="Close command palette"
        onClick={onClose}
        className="fixed inset-0 cursor-default bg-black/65 backdrop-blur-sm"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
        className="relative w-full max-w-xl overflow-hidden rounded-2xl border border-white/10 bg-[#111a2b] shadow-[0_32px_90px_rgba(0,0,0,0.55)]"
      >
        <div className="flex items-center gap-3 border-b border-white/[0.07] px-4">
          <span aria-hidden="true" className="text-gray-600">⌕</span>
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Search commands and conversations…"
            aria-label="Search commands"
            className="h-12 flex-1 bg-transparent text-[13px] text-gray-100 outline-none placeholder:text-gray-600"
          />
          <KeyHint keys={['Esc']} />
        </div>

        <div ref={listRef} className="max-h-[min(24rem,50vh)] overflow-y-auto p-1.5" role="listbox">
          {matches.length === 0 && (
            <p className="px-3 py-8 text-center text-[12px] text-gray-600">No matching command.</p>
          )}
          {matches.map((command, index) => {
            const showGroup = !seenGroups.has(command.group);
            if (showGroup) seenGroups.add(command.group);
            const active = index === cursor;
            return (
              <div key={command.id}>
                {showGroup && (
                  <p className="px-2.5 pb-1 pt-2.5 text-[10px] font-semibold uppercase tracking-[0.16em] text-gray-600">
                    {command.group}
                  </p>
                )}
                <button
                  type="button"
                  role="option"
                  aria-selected={active}
                  data-active={active}
                  onMouseEnter={() => setCursor(index)}
                  onClick={() => commit(command)}
                  className={cx(
                    'flex w-full items-center justify-between gap-3 rounded-lg px-2.5 py-2 text-left transition',
                    active ? 'bg-cyan-300/[0.12] text-white' : 'text-gray-300 hover:bg-white/[0.05]',
                  )}
                >
                  <span className="min-w-0">
                    <span className="block truncate text-[13px]">{command.label}</span>
                    {command.hint && (
                      <span className="mt-0.5 block truncate text-[11px] text-gray-500">{command.hint}</span>
                    )}
                  </span>
                  {command.keys && <KeyHint keys={command.keys} />}
                </button>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/* ── Shortcut reference ───────────────────────────────────────────── */

export function ShortcutHint({ className = '' }: { className?: string }) {
  const mod = useModKey();
  return (
    <span className={cx('inline-flex items-center gap-1.5 text-[10px] text-gray-600', className)}>
      <KeyHint keys={[mod, 'K']} />
      <span>commands</span>
    </span>
  );
}

/**
 * Shared app-level commands. Surfaces extend this with their own.
 */
export function useBaseCommands(): Command[] {
  const router = useRouter();
  const mod = useModKey();
  return useMemo(
    () => [
      {
        id: 'nav.chat',
        label: 'New chat',
        hint: 'Ask a question — no plan, no file changes',
        group: 'Create',
        keys: [mod, 'shift', 'C'],
        run: () => router.push('/chat'),
      },
      {
        id: 'nav.work',
        label: 'New work',
        hint: 'Governed run: inspect, plan, approve, execute',
        group: 'Create',
        keys: [mod, 'shift', 'W'],
        run: () => router.push('/work'),
      },
      {
        id: 'nav.settings',
        label: 'Open Control Center',
        hint: 'Model, roles, workflows, memory, browser policy',
        group: 'Navigate',
        keys: [mod, ','],
        run: () => router.push('/settings'),
      },
    ],
    [router, mod],
  );
}

/**
 * Commands scoped to an open Work run. Only registered for surfaces that can
 * actually perform them — a command that does not exist must never appear.
 */
export function useRunCommands(input: {
  taskId: string;
  onOpenTab: (tab: 'run' | 'activity' | 'project' | 'preview' | 'context' | 'memory') => void;
}): Command[] {
  const mod = useModKey();
  const { taskId, onOpenTab } = input;
  return useMemo(
    () => [
      { id: 'run.activity', label: 'Open activity timeline', hint: 'Every action this run took', group: 'This run', keys: [mod, '2'], run: () => onOpenTab('activity') },
      { id: 'run.context', label: 'Inspect effective context', hint: 'What actually reached the model', group: 'This run', keys: [mod, '5'], run: () => onOpenTab('context') },
      { id: 'run.memory', label: 'Review memory', hint: 'Approve or reject proposals', group: 'This run', keys: [mod, '6'], run: () => onOpenTab('memory') },
      { id: 'run.project', label: 'Browse workspace files', group: 'This run', keys: [mod, '3'], run: () => onOpenTab('project') },
      { id: 'run.preview', label: 'Open preview', group: 'This run', keys: [mod, '4'], run: () => onOpenTab('preview') },
      {
        id: 'run.copyId',
        label: 'Copy run ID',
        hint: taskId,
        group: 'This run',
        run: () => { void navigator.clipboard?.writeText(taskId); },
      },
    ],
    [mod, taskId, onOpenTab],
  );
}

export { Badge };
