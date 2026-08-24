'use client';

import { useState, useRef } from 'react';

const ACTION_ICONS: Record<string, { color: string; icon: string }> = {
  created: { color: 'text-green-400', icon: '+' },
  edited: { color: 'text-amber-400', icon: '~' },
  deleted: { color: 'text-red-400', icon: '-' },
  listed: { color: 'text-content-muted', icon: '>' },
};

const ACTION_LABELS: Record<string, string> = {
  created: 'Created',
  edited: 'Edited',
  deleted: 'Deleted',
  listed: 'Listed',
};

export function FileActivity({ events, isRunning }: { events: { data: Record<string, unknown>; ts: number }[]; isRunning: boolean }) {
  const [expanded, setExpanded] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  const fileEvents = events
    .filter((e) => e.data.action && e.data.path)
    .slice(-20)
    .reverse();

  if (!isRunning && fileEvents.length === 0) return null;

  return (
    <div className="rounded-control border border-line-subtle bg-ink-700/60 overflow-hidden">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex w-full items-center justify-between px-3 py-2 text-meta text-content-secondary hover:text-content-secondary transition-colors"
      >
        <div className="flex items-center gap-2">
          {isRunning && <span className="h-1.5 w-1.5 rounded-full bg-green-400 animate-live-pulse" />}
          <span>file activity</span>
          {fileEvents.length > 0 && (
            <span className="text-micro text-content-muted">({fileEvents.length})</span>
          )}
        </div>
        <svg className={`h-3 w-3 transition-transform ${expanded ? 'rotate-90' : ''}`}
             fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
        </svg>
      </button>
      {expanded && (
        <div ref={scrollRef} className="border-t border-white/[0.04] max-h-40 overflow-y-auto">
          {fileEvents.length === 0 ? (
            <div className="px-3 py-2 text-micro text-content-muted">no file activity yet</div>
          ) : (
            fileEvents.map((ev, i) => {
              const action = String(ev.data.action || 'listed');
              const path = String(ev.data.path || '');
              const style = ACTION_ICONS[action] || ACTION_ICONS.listed;
              return (
                <div key={i} className="flex items-center gap-2 px-3 py-1 hover:bg-ink-700/60">
                  <span className={`font-mono text-micro w-4 text-center ${style.color}`}>{style.icon}</span>
                  <span className="text-micro text-content-muted shrink-0">{ACTION_LABELS[action] || action}</span>
                  <span className="text-micro font-mono text-content-secondary truncate">{path}</span>
                  <span className="ml-auto text-micro text-content-muted shrink-0">
                    {new Date(ev.ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                  </span>
                </div>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}
