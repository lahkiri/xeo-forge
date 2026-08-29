'use client';

/**
 * Desktop titlebar (v1.25, Phase 1.1) — the OS frame is gone (frame: false),
 * and this bar carries the window's identity instead: the brand mark, the
 * surface title, and the min/max/close controls drawn from the SAME icon
 * vocabulary and design tokens as the rest of the app. On the web this
 * renders nothing — the browser owns its own chrome.
 *
 * The whole bar is a drag region (except the controls), so the window moves
 * like a native one on Windows and Linux alike.
 */

import { useEffect, useState } from 'react';

export function DesktopTitleBar({ title = 'Xeo Forge — Control Plane for Agentic Work' }: { title?: string }) {
  const [isDesktop, setIsDesktop] = useState(false);
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined' || !window.xeoDesktop) return;
    setIsDesktop(true);
    const unsubscribe = window.xeoDesktopEvents?.onWindowMaximized?.(setMaximized);
    return () => unsubscribe?.();
  }, []);

  if (!isDesktop) return null;

  const dragStyle = { WebkitAppRegion: 'drag' } as React.CSSProperties;
  const noDragStyle = { WebkitAppRegion: 'noDrag' } as React.CSSProperties;

  return (
    <div
      data-testid="desktop-titlebar"
      style={dragStyle}
      className="sticky top-0 z-40 flex h-9 shrink-0 select-none items-center justify-between border-b border-line-subtle bg-ink-900/85 pl-3.5"
    >
      <div className="flex min-w-0 items-center gap-2">
        <span className="brand-mark h-4 w-4" aria-hidden="true"><span /></span>
        <span className="truncate text-micro font-semibold uppercase tracking-[0.14em] text-content-muted">{title}</span>
      </div>
      <div className="flex h-full" style={noDragStyle}>
        <button
          type="button"
          aria-label="Minimize window"
          title="Minimize"
          onClick={() => void window.xeoDesktop?.windowMinimize()}
          className="flex h-full w-11 items-center justify-center text-content-muted transition hover:bg-ink-700 hover:text-content-primary"
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><path d="M5 12h14" /></svg>
        </button>
        <button
          type="button"
          aria-label={maximized ? 'Restore window' : 'Maximize window'}
          title={maximized ? 'Restore' : 'Maximize'}
          onClick={() => void window.xeoDesktop?.windowMaximizeToggle()}
          className="flex h-full w-11 items-center justify-center text-content-muted transition hover:bg-ink-700 hover:text-content-primary"
        >
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
            {maximized ? (
              <>
                <rect width="9" height="9" x="3" y="3" rx="1" />
                <path d="M9 3v18" />
              </>
            ) : (
              <rect width="12" height="12" x="6" y="6" rx="1.5" />
            )}
          </svg>
        </button>
        <button
          type="button"
          aria-label="Close window"
          title="Close"
          onClick={() => void window.xeoDesktop?.windowClose()}
          className="flex h-full w-11 items-center justify-center text-content-muted transition hover:bg-signal-fail hover:text-white"
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><path d="M18 6 6 18" /><path d="m6 6 12 12" /></svg>
        </button>
      </div>
    </div>
  );
}
