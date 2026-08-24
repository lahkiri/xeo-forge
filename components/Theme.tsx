'use client';

import { useCallback, useEffect, useState } from 'react';
import { cx } from './ui';

/* ------------------------------------------------------------------ */
/*  THEME                                                              */
/*                                                                     */
/*  Both themes share one token vocabulary declared in globals.css, so   */
/*  no component branches on light/dark. The class goes on <html> as     */
/*  data-theme, which Tailwind's darkMode selector reads.               */
/* ------------------------------------------------------------------ */

export type Theme = 'dark' | 'light' | 'system';

const STORAGE_KEY = 'xeo-theme';

function resolve(theme: Theme): 'dark' | 'light' {
  if (theme !== 'system') return theme;
  if (typeof window === 'undefined') return 'light';
  return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
}

function apply(theme: Theme) {
  if (typeof document === 'undefined') return;
  document.documentElement.setAttribute('data-theme', resolve(theme));
}

/**
 * Inline script for the document head. Applies the stored theme before first
 * paint so there is no flash of the wrong theme on load.
 */
export const THEME_BOOTSTRAP = `(function(){try{var t=localStorage.getItem('${STORAGE_KEY}')||'light';var d=t==='system'?(window.matchMedia('(prefers-color-scheme: light)').matches?'light':'dark'):t;document.documentElement.setAttribute('data-theme',d);}catch(e){document.documentElement.setAttribute('data-theme','light');}})()`;

export function useTheme() {
  const [theme, setTheme] = useState<Theme>('light');

  useEffect(() => {
    const stored = (localStorage.getItem(STORAGE_KEY) as Theme | null) ?? 'light';
    setTheme(stored);
    apply(stored);

    // Follow the OS while on `system`.
    const media = window.matchMedia('(prefers-color-scheme: light)');
    const onChange = () => {
      if ((localStorage.getItem(STORAGE_KEY) as Theme | null) === 'system') apply('system');
    };
    media.addEventListener('change', onChange);
    return () => media.removeEventListener('change', onChange);
  }, []);

  const set = useCallback((next: Theme) => {
    setTheme(next);
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch (err) {
      // Private mode or blocked storage: apply for this session and say why.
      console.warn('[theme] could not persist the theme preference:', err);
    }
    apply(next);
  }, []);

  return { theme, setTheme: set, resolved: resolve(theme) };
}

const OPTIONS: { id: Theme; label: string; glyph: string }[] = [
  { id: 'light', label: 'Light', glyph: '☀' },
  { id: 'dark', label: 'Dark', glyph: '☾' },
  { id: 'system', label: 'Match system', glyph: '⌗' },
];

/** Three-state segmented control. Explicit beats a toggle whose state is a guess. */
export function ThemeToggle({ className = '' }: { className?: string }) {
  const { theme, setTheme } = useTheme();

  return (
    <div
      role="radiogroup"
      aria-label="Colour theme"
      className={cx('inline-flex items-center gap-0.5 rounded-control bg-ink-500/60 p-0.5', className)}
    >
      {OPTIONS.map((option) => {
        const active = theme === option.id;
        return (
          <button
            key={option.id}
            type="button"
            role="radio"
            aria-checked={active}
            aria-label={option.label}
            title={option.label}
            onClick={() => setTheme(option.id)}
            className={cx(
              'inline-flex h-6 w-6 items-center justify-center rounded-[0.25rem] text-meta transition-colors duration-instant',
              active
                ? 'bg-ink-700 text-content-primary shadow-raised'
                : 'text-content-muted hover:text-content-secondary',
            )}
          >
            <span aria-hidden="true">{option.glyph}</span>
          </button>
        );
      })}
    </div>
  );
}
