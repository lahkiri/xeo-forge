'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import type { ReactNode } from 'react';
import type { AuthUser } from '@/lib/types';
import { Badge, Button, KeyHint, ToastProvider, cx, useModKey } from './ui';
import { ThemeToggle } from './Theme';
import { CommandPalette, useBaseCommands, useHotkeys, type Command } from './CommandPalette';

/**
 * Navigation model. One glyph per surface — drawn from the same restrained
 * geometric vocabulary as the brand mark, never emoji.
 */
const NAV = [
  { href: '/chat', label: 'Chat', glyph: '◇', hint: 'Conversation only' },
  { href: '/work', label: 'Work', glyph: '◆', hint: 'Governed execution' },
  { href: '/settings', label: 'Control Center', glyph: '⚙', hint: 'Model, roles, policy' },
];

export default function AppShell({
  children,
  user,
  balance,
  localMode,
  flush = false,
  eyebrow = 'XEO FORGE',
  title,
  subtitle,
}: {
  children: ReactNode;
  user?: AuthUser;
  balance?: number;
  localMode?: boolean;
  /** Full-bleed surfaces (Chat, Work) manage their own scroll and padding. */
  flush?: boolean;
  eyebrow?: string;
  title?: string;
  subtitle?: string;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const mod = useModKey();
  const [runtime, setRuntime] = useState<'checking' | 'native' | 'web'>('checking');
  const [update, setUpdate] = useState<DesktopUpdateState | null>(null);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const isLocalSurface = localMode ?? user?.email === 'local-owner@xeo-forge.local';

  useEffect(() => {
    let active = true;
    fetch('/api/runtime', { cache: 'no-store' })
      .then((response) => response.json())
      .then((data: { available?: boolean }) => {
        if (active) setRuntime(data.available ? 'native' : 'web');
      })
      .catch((err) => {
        console.warn('[shell] runtime probe failed:', err);
        if (active) setRuntime('web');
      });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    const desktop = window.xeoDesktop;
    if (!desktop) return;
    let active = true;
    desktop.getUpdateState()
      .then((state) => { if (active) setUpdate(state); })
      .catch((error) => console.warn('[desktop] update state unavailable', error));
    const unsubscribe = window.xeoDesktopEvents?.onUpdateStatus((state) => setUpdate(state));
    return () => { active = false; unsubscribe?.(); };
  }, []);

  const signOut = useCallback(async () => {
    if (isLocalSurface) return;
    await fetch('/api/auth/logout', { method: 'POST' });
    router.push('/login');
    router.refresh();
  }, [isLocalSurface, router]);

  const baseCommands = useBaseCommands();
  const commands: Command[] = useMemo(() => {
    const extra: Command[] = [];
    if (!isLocalSurface && user?.isAdmin) {
      extra.push({
        id: 'nav.admin',
        label: 'Open Admin',
        hint: 'Users, credits, global model',
        group: 'Navigate',
        run: () => router.push('/admin'),
      });
    }
    if (!isLocalSurface && user) {
      extra.push({ id: 'auth.signout', label: 'Sign out', group: 'Account', run: () => void signOut() });
    }
    return [...baseCommands, ...extra];
  }, [baseCommands, isLocalSurface, user, router, signOut]);

  useHotkeys([
    { combo: 'mod+k', run: () => setPaletteOpen((v) => !v), allowInInput: true },
    { combo: 'mod+shift+c', run: () => router.push('/chat') },
    { combo: 'mod+shift+w', run: () => router.push('/work') },
    { combo: 'mod+,', run: () => router.push('/settings') },
  ]);

  const isActive = (href: string) => pathname === href || pathname.startsWith(`${href}/`);
  const showUpdate = update && ['available', 'downloading', 'downloaded', 'success', 'error'].includes(update.status);

  const navItems = user?.isAdmin && !isLocalSurface
    ? [...NAV, { href: '/admin', label: 'Admin', glyph: '⛨', hint: 'Users, credits, global model' }]
    : NAV;

  const shell = (
    <div className="app-shell flex min-h-screen text-content-primary">
      <a href="#main" className="skip-link">Skip to main content</a>

      {/* ── Sidebar ─────────────────────────────────────────────────────
          The workbench silhouette: a fixed instrument rail on the left and
          the surface filling everything else. Vertical nav gives the Work
          surface its full width and reads as a tool, not a website. */}
      <aside className="app-sidebar sticky top-0 z-30 flex h-screen w-[13.5rem] shrink-0 flex-col border-r border-line-subtle">
        {/* Brand */}
        <div className="flex h-14 shrink-0 items-center gap-2.5 border-b border-line-subtle px-4">
          <Link href="/chat" className="flex min-w-0 items-center gap-2.5" aria-label="Xeo Forge">
            <span className="brand-mark h-7 w-7 rounded-control" aria-hidden="true"><span /></span>
            <span className="flex min-w-0 flex-col leading-none">
              <span className="text-ui font-semibold tracking-tight text-content-primary">Xeo Forge</span>
              <span className="mt-1 text-micro uppercase tracking-[0.14em] text-content-faint">Control Plane</span>
            </span>
          </Link>
        </div>

        {/* Command trigger — the second-most-used control, directly under brand */}
        <div className="px-3 pt-3">
          <button
            type="button"
            onClick={() => setPaletteOpen(true)}
            className="sidebar-command group flex w-full items-center gap-2 rounded-control border border-line-subtle bg-ink-700/50 px-2.5 py-2 text-meta text-content-muted transition hover:border-line-strong hover:text-content-secondary"
          >
            <span aria-hidden="true" className="text-ui">⌕</span>
            <span className="flex-1 text-left">Commands</span>
            <KeyHint keys={[mod, 'K']} />
          </button>
        </div>

        {/* Surfaces */}
        <nav aria-label="Surfaces" className="flex-1 overflow-y-auto px-3 py-3">
          <p className="px-2 pb-2 text-micro font-semibold uppercase tracking-[0.16em] text-content-faint">Surfaces</p>
          <ul className="space-y-0.5">
            {navItems.map((item) => {
              const active = isActive(item.href);
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    aria-current={active ? 'page' : undefined}
                    title={item.hint}
                    className={cx(
                      'sidebar-nav-item',
                      active && 'is-active',
                    )}
                  >
                    <span aria-hidden="true" className="sidebar-nav-glyph">{item.glyph}</span>
                    <span className="truncate">{item.label}</span>
                    {active && <span aria-hidden="true" className="sidebar-nav-dash" />}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>

        {/* Instrument footer: runtime, account, theme */}
        <div className="shrink-0 border-t border-line-subtle px-3 py-3">
          <div className="flex items-center justify-between px-2 pb-2.5">
            <span
              title={runtime === 'native' ? 'Go runtime broker connected' : 'Running in web mode'}
              className="flex items-center gap-2 text-micro uppercase tracking-[0.12em] text-content-muted"
            >
              <span
                className={cx(
                  'h-1.5 w-1.5 rounded-full',
                  runtime === 'native' ? 'bg-signal-pass shadow-[0_0_8px_rgba(110,231,183,0.8)]'
                    : runtime === 'checking' ? 'bg-signal-gate/70' : 'bg-gray-600',
                )}
              />
              {runtime === 'native' ? 'Native' : runtime === 'checking' ? '…' : 'Web'}
            </span>
            <ThemeToggle />
          </div>

          {isLocalSurface ? (
            <div className="flex items-center justify-between px-2 pb-1">
              <Badge tone="emerald">Local</Badge>
              <span className="text-micro text-content-faint">offline-first</span>
            </div>
          ) : (
            user && (
              <div className="sidebar-account">
                <span className="sidebar-account-avatar" aria-hidden="true">
                  {(user.displayName || user.email).slice(0, 1).toUpperCase()}
                </span>
                <span className="flex min-w-0 flex-1 flex-col leading-tight">
                  <span className="truncate text-meta font-medium text-content-secondary">{user.displayName || user.email}</span>
                  {typeof balance === 'number' && (
                    <span className="text-micro tabular-nums text-content-faint">{balance.toLocaleString()} credits</span>
                  )}
                </span>
                <button
                  type="button"
                  onClick={signOut}
                  title="Sign out"
                  aria-label="Sign out"
                  className="rounded-control px-1.5 py-1 text-meta text-content-faint transition hover:bg-ink-600 hover:text-content-secondary"
                >
                  ⏻
                </button>
              </div>
            )
          )}
        </div>
      </aside>

      {/* ── Main column ── */}
      <div className="flex min-w-0 flex-1 flex-col">
        {showUpdate && update && (
          <div className="shrink-0 border-b border-signal-run/10 bg-signal-run/05 px-4 py-2">
            <div className="flex flex-wrap items-center justify-between gap-2 text-ui">
              <span className="flex min-w-0 items-center gap-2 text-content-secondary">
                <span
                  className={cx(
                    'h-1.5 w-1.5 shrink-0 rounded-full',
                    update.status === 'error' ? 'bg-red-300' : update.status === 'success' ? 'bg-signal-pass' : 'animate-live-pulse bg-signal-run',
                  )}
                />
                <span className="truncate">
                  {update.message || (update.version ? `Xeo Forge ${update.version} is ready.` : 'Desktop update')}
                </span>
                {update.status === 'downloading' && (
                  <span className="tabular-nums text-content-muted">{update.percent}%</span>
                )}
              </span>
              <span className="flex items-center gap-2">
                {update.status === 'available' && (
                  <Button size="sm" onClick={() => window.xeoDesktop?.downloadUpdate().then(setUpdate)}>
                    Download
                  </Button>
                )}
                {update.status === 'downloaded' && (
                  <Button size="sm" variant="success" onClick={() => window.xeoDesktop?.installUpdate().then(setUpdate)}>
                    Restart to update
                  </Button>
                )}
                {update.status === 'error' && (
                  <Button size="sm" variant="secondary" onClick={() => window.xeoDesktop?.checkForUpdate().then(setUpdate)}>
                    Retry
                  </Button>
                )}
              </span>
            </div>
          </div>
        )}

        {flush ? (
          <div id="main" className="min-h-0 flex-1">{children}</div>
        ) : (
          <main id="main" className="min-h-0 flex-1 overflow-y-auto px-4 py-8 sm:px-6 lg:px-10">
            <div className="mx-auto max-w-6xl">
              {(title || subtitle) && (
                <div className="mb-8">
                  <p className="text-micro font-semibold uppercase tracking-[0.22em] text-signal-run/75">{eyebrow}</p>
                  {title && <h1 className="mt-1.5 text-display font-semibold tracking-tight text-content-primary sm:text-display">{title}</h1>}
                  {subtitle && <p className="mt-2 max-w-2xl text-body leading-6 text-content-muted">{subtitle}</p>}
                </div>
              )}
              {children}
            </div>
          </main>
        )}
      </div>

      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} commands={commands} />
    </div>
  );

  // Toasts are app-wide, so the provider wraps the whole shell.
  return <ToastProvider>{shell}</ToastProvider>;
}
