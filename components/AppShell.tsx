'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import type { ReactNode } from 'react';
import type { AuthUser } from '@/lib/types';
import { Badge, Button, KeyHint, ToastProvider, cx, useModKey } from './ui';
import { CommandPalette, useBaseCommands, useHotkeys, type Command } from './CommandPalette';

const NAV = [
  { href: '/chat', label: 'Chat', hint: 'Conversation only' },
  { href: '/work', label: 'Work', hint: 'Governed execution' },
  { href: '/settings', label: 'Control Center', hint: 'Model, roles, policy' },
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

  const shell = (
    <div className="app-shell flex min-h-screen flex-col text-content-primary">
      {/* ── Top bar: one row, always the same height ── */}
      <header className="sticky top-0 z-30 flex h-14 shrink-0 items-center gap-3 border-b border-line-subtle bg-ink-900/92 px-3 backdrop-blur-xl sm:px-4">
        <Link href="/chat" className="flex shrink-0 items-center gap-2.5" aria-label="Xeo Forge">
          <span className="brand-mark h-7 w-7 rounded-control" aria-hidden="true"><span /></span>
          <span className="hidden text-sm font-semibold tracking-tight text-white sm:block">Xeo Forge</span>
        </Link>

        <nav aria-label="Surfaces" className="flex min-w-0 items-center gap-0.5">
          {NAV.map((item) => {
            const active = isActive(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? 'page' : undefined}
                title={item.hint}
                className={cx(
                  'inline-flex h-8 items-center rounded-control px-2.5 text-ui font-medium transition',
                  active ? 'bg-ink-600 text-white' : 'text-content-muted hover:bg-ink-700 hover:text-content-secondary',
                )}
              >
                {item.label}
              </Link>
            );
          })}
          {!isLocalSurface && user?.isAdmin && (
            <Link
              href="/admin"
              className={cx(
                'inline-flex h-8 items-center rounded-control px-2.5 text-ui font-medium transition',
                isActive('/admin') ? 'bg-signal-plan/14 text-signal-plan' : 'text-content-muted hover:bg-ink-700 hover:text-content-secondary',
              )}
            >
              Admin
            </Link>
          )}
        </nav>

        <div className="ml-auto flex shrink-0 items-center gap-2">
          <button
            type="button"
            onClick={() => setPaletteOpen(true)}
            className="hidden h-8 items-center gap-2 rounded-control border border-line-subtle bg-ink-700/60 px-2.5 text-meta text-content-muted transition hover:border-line-strong hover:text-content-secondary sm:inline-flex"
          >
            <span aria-hidden="true">⌕</span>
            <span>Commands</span>
            <KeyHint keys={[mod, 'K']} />
          </button>

          <span
            title={runtime === 'native' ? 'Go runtime broker connected' : 'Running in web mode'}
            className="hidden items-center gap-1.5 text-micro uppercase tracking-[0.1em] text-content-muted lg:inline-flex"
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

          {isLocalSurface ? (
            <Badge tone="emerald" className="hidden sm:inline-flex">Local</Badge>
          ) : (
            typeof balance === 'number' && (
              <span className="hidden items-center gap-1.5 rounded-control border border-line-subtle px-2.5 py-1.5 text-meta sm:inline-flex">
                <span className="text-content-muted">Credits</span>
                <span className="font-semibold tabular-nums text-content-primary">{balance}</span>
              </span>
            )
          )}

          {!isLocalSurface && user && (
            <Button variant="ghost" size="sm" onClick={signOut}>Sign out</Button>
          )}
        </div>
      </header>

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
        <div className="min-h-0 flex-1">{children}</div>
      ) : (
        <main className="min-h-0 flex-1 overflow-y-auto px-4 py-6 sm:px-6 lg:px-8">
          <div className="mx-auto max-w-6xl">
            {(title || subtitle) && (
              <div className="mb-6">
                <p className="text-micro font-semibold uppercase tracking-[0.22em] text-signal-run/75">{eyebrow}</p>
                {title && <h1 className="mt-1.5 text-xl font-semibold tracking-tight text-white sm:text-2xl">{title}</h1>}
                {subtitle && <p className="mt-1.5 max-w-2xl text-body leading-6 text-content-muted">{subtitle}</p>}
              </div>
            )}
            {children}
          </div>
        </main>
      )}

      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} commands={commands} />
    </div>
  );

  // Toasts are app-wide, so the provider wraps the whole shell.
  return <ToastProvider>{shell}</ToastProvider>;
}
