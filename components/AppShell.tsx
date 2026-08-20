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
    <div className="app-shell flex min-h-screen flex-col text-gray-100">
      {/* ── Top bar: one row, always the same height ── */}
      <header className="sticky top-0 z-30 flex h-14 shrink-0 items-center gap-3 border-b border-white/[0.07] bg-[#080c14]/90 px-3 backdrop-blur-xl sm:px-4">
        <Link href="/chat" className="flex shrink-0 items-center gap-2.5" aria-label="Xeo Forge">
          <span className="brand-mark h-7 w-7 rounded-lg" aria-hidden="true"><span /></span>
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
                  'inline-flex h-8 items-center rounded-lg px-2.5 text-[12px] font-medium transition',
                  active ? 'bg-white/[0.09] text-white' : 'text-gray-500 hover:bg-white/[0.05] hover:text-gray-300',
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
                'inline-flex h-8 items-center rounded-lg px-2.5 text-[12px] font-medium transition',
                isActive('/admin') ? 'bg-violet-300/[0.14] text-violet-100' : 'text-gray-500 hover:bg-white/[0.05] hover:text-gray-300',
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
            className="hidden h-8 items-center gap-2 rounded-lg border border-white/[0.08] bg-white/[0.03] px-2.5 text-[11px] text-gray-500 transition hover:border-white/[0.16] hover:text-gray-300 sm:inline-flex"
          >
            <span aria-hidden="true">⌕</span>
            <span>Commands</span>
            <KeyHint keys={[mod, 'K']} />
          </button>

          <span
            title={runtime === 'native' ? 'Go runtime broker connected' : 'Running in web mode'}
            className="hidden items-center gap-1.5 text-[10px] uppercase tracking-[0.1em] text-gray-600 lg:inline-flex"
          >
            <span
              className={cx(
                'h-1.5 w-1.5 rounded-full',
                runtime === 'native' ? 'bg-emerald-300 shadow-[0_0_8px_rgba(110,231,183,0.8)]'
                  : runtime === 'checking' ? 'bg-amber-300/70' : 'bg-gray-600',
              )}
            />
            {runtime === 'native' ? 'Native' : runtime === 'checking' ? '…' : 'Web'}
          </span>

          {isLocalSurface ? (
            <Badge tone="emerald" className="hidden sm:inline-flex">Local</Badge>
          ) : (
            typeof balance === 'number' && (
              <span className="hidden items-center gap-1.5 rounded-lg border border-white/[0.08] px-2.5 py-1.5 text-[11px] sm:inline-flex">
                <span className="text-gray-600">Credits</span>
                <span className="font-semibold tabular-nums text-gray-200">{balance}</span>
              </span>
            )
          )}

          {!isLocalSurface && user && (
            <Button variant="ghost" size="sm" onClick={signOut}>Sign out</Button>
          )}
        </div>
      </header>

      {showUpdate && update && (
        <div className="shrink-0 border-b border-cyan-300/10 bg-cyan-300/[0.05] px-4 py-2">
          <div className="flex flex-wrap items-center justify-between gap-2 text-[12px]">
            <span className="flex min-w-0 items-center gap-2 text-gray-300">
              <span
                className={cx(
                  'h-1.5 w-1.5 shrink-0 rounded-full',
                  update.status === 'error' ? 'bg-red-300' : update.status === 'success' ? 'bg-emerald-300' : 'animate-pulse bg-cyan-300',
                )}
              />
              <span className="truncate">
                {update.message || (update.version ? `Xeo Forge ${update.version} is ready.` : 'Desktop update')}
              </span>
              {update.status === 'downloading' && (
                <span className="tabular-nums text-gray-500">{update.percent}%</span>
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
                <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-cyan-300/75">{eyebrow}</p>
                {title && <h1 className="mt-1.5 text-xl font-semibold tracking-tight text-white sm:text-2xl">{title}</h1>}
                {subtitle && <p className="mt-1.5 max-w-2xl text-[13px] leading-6 text-gray-500">{subtitle}</p>}
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
