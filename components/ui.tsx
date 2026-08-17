'use client';

import { ReactNode, ButtonHTMLAttributes } from 'react';

export function Button({
  children,
  variant = 'primary',
  size = 'md',
  className = '',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  size?: 'sm' | 'md' | 'lg';
}) {
  const base =
    'inline-flex items-center justify-center gap-2 rounded-xl font-medium transition-all duration-200 focus-visible:ring-2 focus-visible:ring-cyan-400/60 disabled:cursor-not-allowed disabled:opacity-40';
  const sizes = {
    sm: 'px-3 py-1.5 text-xs',
    md: 'px-3.5 py-2 text-sm',
    lg: 'px-4.5 py-2.5 text-sm',
  };
  const styles = {
    primary: 'border border-cyan-300/20 bg-cyan-300 text-slate-950 shadow-[0_0_24px_rgba(103,232,249,0.14)] hover:bg-cyan-200 hover:shadow-[0_0_30px_rgba(103,232,249,0.24)]',
    secondary: 'border border-white/10 bg-white/[0.07] text-gray-100 hover:border-white/20 hover:bg-white/[0.11]',
    ghost: 'border border-transparent bg-transparent text-gray-400 hover:border-white/10 hover:bg-white/[0.05] hover:text-gray-100',
    danger: 'border border-red-400/20 bg-red-500/15 text-red-200 hover:bg-red-500/25',
  };
  return (
    <button className={`${base} ${sizes[size]} ${styles[variant]} ${className}`} {...props}>
      {children}
    </button>
  );
}

export function Card({ children, className = '', interactive = false }: { children: ReactNode; className?: string; interactive?: boolean }) {
  const hasPadOverride = /(?:^|\s)(p-|px-|py-)/.test(className);
  const base = `rounded-2xl border border-white/[0.08] bg-white/[0.035] shadow-[0_18px_60px_rgba(0,0,0,0.16)] backdrop-blur-sm ${hasPadOverride ? '' : 'p-5'} ${interactive ? 'transition duration-200 hover:-translate-y-0.5 hover:border-cyan-300/20 hover:bg-white/[0.05]' : ''} ${className}`;
  return <div className={base}>{children}</div>;
}

export function Eyebrow({ children, tone = 'cyan' }: { children: ReactNode; tone?: 'cyan' | 'violet' | 'amber' }) {
  const tones = {
    cyan: 'text-cyan-300/80',
    violet: 'text-violet-300/80',
    amber: 'text-amber-300/80',
  };
  return <p className={`text-[10px] font-semibold uppercase tracking-[0.24em] ${tones[tone]}`}>{children}</p>;
}

export function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    pending: 'bg-slate-500/15 text-slate-300 border-slate-400/10',
    running: 'bg-cyan-400/15 text-cyan-200 border-cyan-300/15',
    planned: 'bg-amber-400/15 text-amber-200 border-amber-300/15',
    completed: 'bg-emerald-400/15 text-emerald-200 border-emerald-300/15',
    failed: 'bg-red-400/15 text-red-200 border-red-300/15',
  };
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide ${colors[status] ?? colors.pending}`}>
      {status === 'running' && <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-current" />}
      {status}
    </span>
  );
}

export function Metric({ label, value, detail }: { label: string; value: ReactNode; detail?: string }) {
  return (
    <div className="rounded-2xl border border-white/[0.07] bg-black/10 px-4 py-3">
      <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-gray-500">{label}</p>
      <p className="mt-1 text-xl font-semibold tracking-tight text-gray-100">{value}</p>
      {detail && <p className="mt-1 text-[11px] text-gray-500">{detail}</p>}
    </div>
  );
}
