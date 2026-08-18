'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import type { ReactNode } from 'react';
import type { AuthUser } from '@/lib/types';

const links = [
  { href: '/dashboard', label: 'Workbench', hint: 'Runs and tasks' },
  { href: '/settings', label: 'Control Center', hint: 'Behavior and memory' },
];

export default function AppShell({
  children,
  user,
  balance,
  eyebrow = 'XEO FORGE',
  title,
  subtitle,
}: {
  children: ReactNode;
  user?: AuthUser;
  balance?: number;
  eyebrow?: string;
  title?: string;
  subtitle?: string;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [runtime, setRuntime] = useState<'checking' | 'native' | 'web'>('checking');
  const isLocalOwner = user?.email === 'local-owner@xeo-forge.local';

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
    if (isLocalOwner) return;
    await fetch('/api/auth/logout', { method: 'POST' });
    router.push('/login');
    router.refresh();
  }

  return (
    <div className="app-shell min-h-screen text-gray-100">
      <div className="mx-auto flex min-h-screen max-w-[1480px]">
        <aside className="hidden w-64 shrink-0 border-r border-white/[0.07] px-5 py-6 lg:flex lg:flex-col">
          <Link href="/dashboard" className="flex items-center gap-3 px-2">
            <span className="brand-mark" aria-hidden="true"><span /></span>
            <span>
              <span className="block text-sm font-semibold tracking-tight text-white">Xeo Forge</span>
              <span className="block text-[10px] uppercase tracking-[0.18em] text-gray-500">Agentic control plane</span>
            </span>
          </Link>
          <nav className="mt-10 space-y-1" aria-label="Primary navigation">
            <p className="mb-3 px-3 text-[10px] font-semibold uppercase tracking-[0.2em] text-gray-600">Operate</p>
            {links.map((link) => {
              const active = pathname === link.href || (link.href !== '/dashboard' && pathname.startsWith(link.href));
              return (
                <Link key={link.href} href={link.href} className={`group flex items-center gap-3 rounded-xl px-3 py-3 transition ${active ? 'border border-cyan-300/10 bg-cyan-300/[0.08] text-cyan-100' : 'text-gray-500 hover:bg-white/[0.05] hover:text-gray-200'}`}>
                  <span className={`nav-dot ${active ? 'bg-cyan-300 shadow-[0_0_12px_rgba(103,232,249,0.8)]' : 'bg-gray-700 group-hover:bg-gray-400'}`} />
                  <span>
                    <span className="block text-sm font-medium">{link.label}</span>
                    <span className="mt-0.5 block text-[10px] text-gray-600 group-hover:text-gray-500">{link.hint}</span>
                  </span>
                </Link>
              );
            })}
          </nav>
          <div className="mt-auto rounded-2xl border border-violet-300/10 bg-violet-300/[0.05] p-4">
            <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-violet-300/80">Governed by design</p>
            <p className="mt-2 text-xs leading-5 text-gray-400">Every run carries its role, workflow, context, and approval boundary.</p>
          </div>
        </aside>

        <div className="min-w-0 flex-1">
          <header className="sticky top-0 z-20 border-b border-white/[0.07] bg-[#080c14]/85 px-4 py-4 backdrop-blur-xl sm:px-6 lg:px-10">
            <div className="mx-auto flex max-w-6xl items-center justify-between gap-4">
              <div className="min-w-0">
                <p className="text-[10px] font-semibold uppercase tracking-[0.24em] text-cyan-300/75">{eyebrow}</p>
                {title && <h1 className="mt-1 truncate text-xl font-semibold tracking-tight text-white sm:text-2xl">{title}</h1>}
                {subtitle && <p className="mt-1 hidden max-w-2xl text-xs leading-5 text-gray-500 sm:block">{subtitle}</p>}
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <span className="hidden items-center gap-1.5 rounded-xl border border-white/[0.08] bg-white/[0.035] px-3 py-2 text-[10px] uppercase tracking-[0.12em] text-gray-500 sm:inline-flex" title={runtime === 'native' ? 'Go runtime broker connected' : 'Running in web mode'}><span className={`h-1.5 w-1.5 rounded-full ${runtime === 'native' ? 'bg-emerald-300 shadow-[0_0_8px_rgba(110,231,183,0.8)]' : runtime === 'checking' ? 'bg-amber-300/70' : 'bg-gray-600'}`} />{runtime === 'native' ? 'Native runtime' : runtime === 'checking' ? 'Checking runtime' : 'Web runtime'}</span>
                {isLocalOwner && <span className="hidden rounded-xl border border-emerald-300/15 bg-emerald-300/[0.06] px-3 py-2 text-[10px] uppercase tracking-[0.12em] text-emerald-200/80 sm:inline-flex">Local workspace</span>}
                {typeof balance === 'number' && <span className="hidden rounded-xl border border-white/[0.08] bg-white/[0.035] px-3 py-2 text-xs text-gray-400 sm:inline-flex"><span className="mr-1.5 text-gray-600">{isLocalOwner ? 'Local credits' : 'Credits'}</span><span className="font-semibold text-gray-200">{balance}</span></span>}
                {user?.isAdmin && <Link href="/admin" className="hidden rounded-xl px-3 py-2 text-xs text-gray-500 hover:bg-white/[0.05] hover:text-gray-200 sm:inline-flex">Admin</Link>}
                {user && !isLocalOwner && <button onClick={signOut} className="rounded-xl border border-white/[0.08] px-3 py-2 text-xs text-gray-400 transition hover:border-white/20 hover:text-white">Sign out</button>}
              </div>
            </div>
            <nav className="mx-auto mt-4 flex max-w-6xl gap-2 overflow-x-auto lg:hidden" aria-label="Mobile navigation">
              {links.map((link) => {
                const active = pathname === link.href || (link.href !== '/dashboard' && pathname.startsWith(link.href));
                return <Link key={link.href} href={link.href} aria-current={active ? 'page' : undefined} className={`whitespace-nowrap rounded-xl border px-3 py-2 text-xs transition ${active ? 'border-cyan-300/20 bg-cyan-300/[0.1] text-cyan-100' : 'border-white/[0.08] text-gray-500 hover:border-white/15 hover:text-gray-200'}`}>{link.label}</Link>;
              })}
            </nav>
          </header>
          <main className="px-4 py-6 sm:px-6 lg:px-10 lg:py-8"><div className="mx-auto max-w-6xl">{children}</div></main>
        </div>
      </div>
    </div>
  );
}
