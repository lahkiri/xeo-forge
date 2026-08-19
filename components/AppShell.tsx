'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import type { ReactNode } from 'react';
import type { AuthUser } from '@/lib/types';

const links = [
  { href: '/dashboard', label: 'Workbench', hint: 'Start and resume work' },
  { href: '/settings', label: 'Control Center', hint: 'Agent and workspace setup' },
];

export default function AppShell({
  children,
  user,
  balance,
  localMode,
  eyebrow = 'XEO FORGE',
  title,
  subtitle,
}: {
  children: ReactNode;
  user?: AuthUser;
  balance?: number;
  localMode?: boolean;
  eyebrow?: string;
  title?: string;
  subtitle?: string;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [runtime, setRuntime] = useState<'checking' | 'native' | 'web'>('checking');
  const [update, setUpdate] = useState<DesktopUpdateState | null>(null);
  const isLocalSurface = localMode ?? user?.email === 'local-owner@xeo-forge.local';

  useEffect(() => {
    let active = true;
    fetch('/api/runtime', { cache: 'no-store' })
      .then((response) => response.json())
      .then((data: { available?: boolean }) => {
        if (active) setRuntime(data.available ? 'native' : 'web');
      })
      .catch(() => {
        if (active) setRuntime('web');
      });
    return () => { active = false; };
  }, []);

  async function signOut() {
    if (isLocalSurface) return;
    await fetch('/api/auth/logout', { method: 'POST' });
    router.push('/login');
    router.refresh();
  }

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

  async function downloadUpdate() {
    if (!window.xeoDesktop) return;
    const state = await window.xeoDesktop.downloadUpdate();
    setUpdate(state);
  }

  async function installUpdate() {
    if (!window.xeoDesktop) return;
    const state = await window.xeoDesktop.installUpdate();
    setUpdate(state);
  }

  const showUpdate = update && ['available', 'downloading', 'downloaded', 'success', 'error'].includes(update.status);
  const isActive = (href: string) => pathname === href || (href !== '/dashboard' && pathname.startsWith(href));

  return (
    <div className="app-shell min-h-screen text-gray-100">
      <div className="mx-auto flex min-h-screen max-w-[1540px]">
        <aside className="hidden w-[238px] shrink-0 border-r border-white/[0.07] px-4 py-5 lg:flex lg:flex-col">
          <Link href="/dashboard" className="flex items-center gap-3 px-3" aria-label="Xeo Forge Workbench">
            <span className="brand-mark" aria-hidden="true"><span /></span>
            <span className="min-w-0">
              <span className="block text-sm font-semibold tracking-tight text-white">Xeo Forge</span>
              <span className="mt-0.5 block truncate text-[10px] uppercase tracking-[0.18em] text-gray-500">Local-first agent work</span>
            </span>
          </Link>

          <div className="mt-10 px-3">
            <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-gray-600">Navigate</p>
            <nav className="mt-3 space-y-1" aria-label="Primary navigation">
              {links.map((link) => {
                const active = isActive(link.href);
                return (
                  <Link key={link.href} href={link.href} className={`group flex items-center gap-3 rounded-xl border px-3 py-3 transition ${active ? 'border-cyan-300/15 bg-cyan-300/[0.08] text-cyan-100' : 'border-transparent text-gray-500 hover:border-white/[0.06] hover:bg-white/[0.04] hover:text-gray-200'}`}>
                    <span className={`nav-dot ${active ? 'bg-cyan-300 shadow-[0_0_12px_rgba(103,232,249,0.8)]' : 'bg-gray-700 group-hover:bg-gray-400'}`} />
                    <span className="min-w-0">
                      <span className="block text-sm font-medium">{link.label}</span>
                      <span className="mt-0.5 block truncate text-[10px] text-gray-600 group-hover:text-gray-500">{link.hint}</span>
                    </span>
                  </Link>
                );
              })}
              {!isLocalSurface && user?.isAdmin && (
                <Link href="/admin" className={`group mt-3 flex items-center gap-3 rounded-xl border px-3 py-3 transition ${isActive('/admin') ? 'border-violet-300/15 bg-violet-300/[0.08] text-violet-100' : 'border-transparent text-gray-500 hover:border-white/[0.06] hover:bg-white/[0.04] hover:text-gray-200'}`}>
                  <span className={`nav-dot ${isActive('/admin') ? 'bg-violet-300' : 'bg-gray-700 group-hover:bg-gray-400'}`} />
                  <span className="min-w-0"><span className="block text-sm font-medium">Admin</span><span className="mt-0.5 block truncate text-[10px] text-gray-600">SaaS operations</span></span>
                </Link>
              )}
            </nav>
          </div>

          <div className="mt-auto space-y-3">
            {isLocalSurface ? (
              <div className="rounded-2xl border border-emerald-300/15 bg-emerald-300/[0.05] p-4">
                <div className="flex items-center gap-2"><span className="h-2 w-2 rounded-full bg-emerald-300 shadow-[0_0_10px_rgba(110,231,183,0.65)]" /><p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-emerald-200/80">Local workspace</p></div>
                <p className="mt-2 text-xs leading-5 text-gray-400">Your work, project files, and history stay on this device.</p>
              </div>
            ) : (
              <div className="rounded-2xl border border-violet-300/10 bg-violet-300/[0.05] p-4">
                <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-violet-300/80">SaaS workspace</p>
                <p className="mt-2 text-xs leading-5 text-gray-400">Account, credits, and team controls live in the hosted surface.</p>
              </div>
            )}
          </div>
        </aside>

        <div className="min-w-0 flex-1">
          <header className="sticky top-0 z-20 border-b border-white/[0.07] bg-[#080c14]/88 px-4 py-4 backdrop-blur-xl sm:px-6 lg:px-10">
            <div className="mx-auto flex max-w-6xl items-start justify-between gap-4">
              <div className="min-w-0">
                <p className="text-[10px] font-semibold uppercase tracking-[0.24em] text-cyan-300/75">{eyebrow}</p>
                {title && <h1 className="mt-1 truncate text-xl font-semibold tracking-tight text-white sm:text-2xl">{title}</h1>}
                {subtitle && <p className="mt-1 hidden max-w-2xl text-xs leading-5 text-gray-500 sm:block">{subtitle}</p>}
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <span className="hidden items-center gap-1.5 rounded-xl border border-white/[0.08] bg-white/[0.035] px-3 py-2 text-[10px] uppercase tracking-[0.12em] text-gray-500 sm:inline-flex" title={runtime === 'native' ? 'Go runtime broker connected' : 'Running in web mode'}><span className={`h-1.5 w-1.5 rounded-full ${runtime === 'native' ? 'bg-emerald-300 shadow-[0_0_8px_rgba(110,231,183,0.8)]' : runtime === 'checking' ? 'bg-amber-300/70' : 'bg-gray-600'}`} />{runtime === 'native' ? 'Native runtime' : runtime === 'checking' ? 'Checking runtime' : 'Web runtime'}</span>
                {isLocalSurface && <span className="hidden rounded-xl border border-emerald-300/15 bg-emerald-300/[0.06] px-3 py-2 text-[10px] uppercase tracking-[0.12em] text-emerald-200/80 sm:inline-flex">Local workspace</span>}
                {!isLocalSurface && typeof balance === 'number' && <span className="hidden rounded-xl border border-white/[0.08] bg-white/[0.035] px-3 py-2 text-xs text-gray-400 sm:inline-flex"><span className="mr-1.5 text-gray-600">Credits</span><span className="font-semibold text-gray-200">{balance}</span></span>}
                {!isLocalSurface && user && <button onClick={signOut} className="rounded-xl border border-white/[0.08] px-3 py-2 text-xs text-gray-400 transition hover:border-white/20 hover:text-white">Sign out</button>}
              </div>
            </div>
            <nav className="mx-auto mt-4 flex max-w-6xl gap-2 overflow-x-auto lg:hidden" aria-label="Mobile navigation">
              {links.map((link) => {
                const active = isActive(link.href);
                return <Link key={link.href} href={link.href} aria-current={active ? 'page' : undefined} className={`whitespace-nowrap rounded-xl border px-3 py-2 text-xs transition ${active ? 'border-cyan-300/20 bg-cyan-300/[0.1] text-cyan-100' : 'border-white/[0.08] text-gray-500 hover:border-white/15 hover:text-gray-200'}`}>{link.label}</Link>;
              })}
              {!isLocalSurface && user?.isAdmin && <Link href="/admin" className="whitespace-nowrap rounded-xl border border-white/[0.08] px-3 py-2 text-xs text-gray-500 hover:border-white/15 hover:text-gray-200">Admin</Link>}
            </nav>
          </header>

          {showUpdate && update && (
            <div className="border-b border-cyan-300/10 bg-cyan-300/[0.04] px-4 py-2.5 sm:px-6 lg:px-10">
              <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-2 text-xs">
                <div className="flex min-w-0 items-center gap-2 text-gray-300">
                  <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${update.status === 'error' ? 'bg-red-300' : update.status === 'success' ? 'bg-emerald-300' : 'bg-cyan-300 animate-pulse'}`} />
                  <span className="truncate">{update.message || (update.version ? `Xeo Forge ${update.version} is ready.` : 'Desktop update')}</span>
                  {update.status === 'downloading' && <span className="text-gray-500 tabular-nums">{update.percent}%</span>}
                </div>
                <div className="flex items-center gap-2">
                  {update.status === 'available' && <button type="button" onClick={downloadUpdate} className="rounded-lg bg-cyan-300 px-2.5 py-1.5 text-[11px] font-bold text-[#071018] hover:bg-cyan-200">Download update</button>}
                  {update.status === 'downloaded' && <button type="button" onClick={installUpdate} className="rounded-lg bg-emerald-300 px-2.5 py-1.5 text-[11px] font-bold text-[#071018] hover:bg-emerald-200">Restart to update</button>}
                  {update.status === 'error' && <button type="button" onClick={() => window.xeoDesktop?.checkForUpdate().then(setUpdate)} className="rounded-lg border border-white/10 px-2.5 py-1.5 text-[11px] text-gray-300 hover:bg-white/[0.06]">Retry</button>}
                </div>
              </div>
            </div>
          )}
          <main className="px-4 py-6 sm:px-6 lg:px-10 lg:py-8"><div className="mx-auto max-w-6xl">{children}</div></main>
        </div>
      </div>
    </div>
  );
}
