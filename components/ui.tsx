'use client';

import { ReactNode, ButtonHTMLAttributes } from 'react';

/* Minimal shared UI primitives. */

export function Button({
  children,
  variant = 'primary',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'ghost' | 'danger' }) {
  const base =
    'inline-flex items-center justify-center rounded-lg px-3.5 py-2 text-sm font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed';
  const styles: Record<string, string> = {
    primary: 'bg-indigo-600 hover:bg-indigo-500 text-white',
    ghost: 'bg-transparent hover:bg-white/[0.06] text-gray-300 border border-white/10',
    danger: 'bg-red-600 hover:bg-red-500 text-white',
  };
  return (
    <button className={`${base} ${styles[variant]}`} {...props}>
      {children}
    </button>
  );
}

export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  const hasPadOverride = /(?:^|\s)(p-|px-|py-)/.test(className);
  const base = `rounded-xl border border-white/[0.06] bg-white/[0.02] ${hasPadOverride ? '' : 'p-4'} ${className}`;
  return (
    <div className={base}>
      {children}
    </div>
  );
}

export function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    pending: 'bg-gray-500/15 text-gray-400',
    running: 'bg-blue-500/15 text-blue-400',
    planned: 'bg-amber-500/15 text-amber-400',
    completed: 'bg-green-500/15 text-green-400',
    failed: 'bg-red-500/15 text-red-400',
  };
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium ${colors[status] ?? colors.pending}`}>
      {status === 'running' && <span className="mr-1 h-1.5 w-1.5 rounded-full bg-blue-400 animate-pulse" />}
      {status}
    </span>
  );
}
