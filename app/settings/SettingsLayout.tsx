'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { AuthUser } from '@/lib/types';
import AppShell from '@/components/AppShell';
import { ThemeToggle } from '@/components/Theme';
import { cx } from '@/components/ui';
import { IconArrowLeft, IconChevronRight } from '@/components/icons';

const SECTIONS = [
  { href: '/settings/providers', label: 'Providers', detail: 'Connections & models', marker: '01' },
  { href: '/settings/runtime', label: 'Runtime', detail: 'Updates & browser', marker: '02' },
  { href: '/settings/profiles', label: 'Profiles', detail: 'Agent roles', marker: '03' },
  { href: '/settings/skills', label: 'Skills', detail: 'Reusable workflows', marker: '04' },
  { href: '/settings/mcp', label: 'MCP', detail: 'External tools', marker: '05' },
  { href: '/settings/memory', label: 'Memory', detail: 'Instructions & recall', marker: '06' },
];

export default function SettingsLayout({ user, localMode, children }: { user: AuthUser; localMode: boolean; children: React.ReactNode }) {
  const pathname = usePathname();
  return (
    <AppShell user={user} localMode={localMode} flush>
      <div className="settings-shell">
        <aside className="settings-sidebar">
          <div className="settings-sidebar-head">
            <Link href="/chat" className="settings-back"><IconArrowLeft size={12} /> <span>Workspace</span></Link>
            <div className="settings-title-block"><span className="codex-kicker">Xeo Forge</span><h1>Settings</h1><p>Shape how your workspace runs.</p></div>
          </div>
          <nav className="settings-nav" aria-label="Settings sections">
            {SECTIONS.map((section) => {
              const active = pathname === section.href || pathname.startsWith(`${section.href}/`);
              return <Link key={section.href} href={section.href} className={cx('settings-nav-row', active && 'is-active')}><span className="settings-nav-marker">{section.marker}</span><span><strong>{section.label}</strong><small>{section.detail}</small></span><span className="settings-nav-arrow"><IconChevronRight size={12} /></span></Link>;
            })}
          </nav>
          <div className="settings-sidebar-foot"><span>{localMode ? 'Local runtime' : 'Gateway connected'}</span><ThemeToggle /></div>
        </aside>
        <main className="settings-main">{children}</main>
      </div>
    </AppShell>
  );
}
