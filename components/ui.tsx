'use client';

import {
  ButtonHTMLAttributes,
  InputHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes,
  TextareaHTMLAttributes,
  createContext,
  forwardRef,
  useContext,
  useEffect,
  useId,
  useState,
} from 'react';

/* ------------------------------------------------------------------ */
/*  Primitives. Everything visual lives here so the surfaces stay      */
/*  layout-only and detail-level styling cannot drift per file.        */
/* ------------------------------------------------------------------ */

export function cx(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(' ');
}

/* ── Button ───────────────────────────────────────────────────────── */

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'success';
export type ButtonSize = 'sm' | 'md' | 'lg';

const BUTTON_SIZES: Record<ButtonSize, string> = {
  sm: 'h-7 gap-1.5 px-2.5 text-[11px]',
  md: 'h-9 gap-2 px-3.5 text-[13px]',
  lg: 'h-11 gap-2 px-5 text-sm',
};

const BUTTON_VARIANTS: Record<ButtonVariant, string> = {
  primary:
    'bg-cyan-300 text-slate-950 font-semibold shadow-[0_0_20px_-4px_rgba(103,232,249,0.5)] hover:bg-cyan-200 active:bg-cyan-400',
  secondary:
    'border border-white/10 bg-white/[0.06] text-gray-100 hover:border-white/20 hover:bg-white/[0.1]',
  ghost:
    'border border-transparent text-gray-400 hover:bg-white/[0.06] hover:text-gray-100',
  danger:
    'border border-red-400/25 bg-red-500/12 text-red-200 hover:border-red-400/40 hover:bg-red-500/20',
  success:
    'bg-emerald-300 text-slate-950 font-semibold shadow-[0_0_20px_-4px_rgba(110,231,183,0.5)] hover:bg-emerald-200',
};

export const Button = forwardRef<
  HTMLButtonElement,
  ButtonHTMLAttributes<HTMLButtonElement> & {
    variant?: ButtonVariant;
    size?: ButtonSize;
    loading?: boolean;
    icon?: ReactNode;
  }
>(function Button(
  { children, variant = 'primary', size = 'md', loading = false, icon, className = '', disabled, ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      disabled={disabled || loading}
      className={cx(
        'inline-flex shrink-0 items-center justify-center rounded-lg font-medium transition-all duration-150',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/60 focus-visible:ring-offset-1 focus-visible:ring-offset-[#0c1320]',
        'disabled:pointer-events-none disabled:opacity-40',
        BUTTON_SIZES[size],
        BUTTON_VARIANTS[variant],
        className,
      )}
      {...props}
    >
      {loading ? <Spinner /> : icon}
      {children}
    </button>
  );
});

export function Spinner({ className = '' }: { className?: string }) {
  return (
    <span
      role="status"
      aria-label="Loading"
      className={cx('h-3.5 w-3.5 shrink-0 animate-spin rounded-full border-[1.5px] border-current border-t-transparent', className)}
    />
  );
}

/* ── IconButton ───────────────────────────────────────────────────── */

export const IconButton = forwardRef<
  HTMLButtonElement,
  ButtonHTMLAttributes<HTMLButtonElement> & { label: string; size?: 'sm' | 'md' }
>(function IconButton({ label, children, size = 'md', className = '', ...props }, ref) {
  return (
    <button
      ref={ref}
      aria-label={label}
      title={label}
      className={cx(
        'inline-flex shrink-0 items-center justify-center rounded-lg border border-transparent text-gray-500 transition',
        'hover:bg-white/[0.07] hover:text-gray-100',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/60',
        'disabled:pointer-events-none disabled:opacity-40',
        size === 'sm' ? 'h-6 w-6' : 'h-8 w-8',
        className,
      )}
      {...props}
    >
      {children}
    </button>
  );
});

/* ── Surfaces ─────────────────────────────────────────────────────── */

export function Card({
  children,
  className = '',
  interactive = false,
  tone = 'default',
}: {
  children: ReactNode;
  className?: string;
  interactive?: boolean;
  tone?: 'default' | 'cyan' | 'violet' | 'amber' | 'emerald' | 'red';
}) {
  const tones = {
    default: 'border-white/[0.08] bg-white/[0.03]',
    cyan: 'border-cyan-300/20 bg-cyan-300/[0.05]',
    violet: 'border-violet-300/20 bg-violet-300/[0.05]',
    amber: 'border-amber-300/20 bg-amber-300/[0.05]',
    emerald: 'border-emerald-300/20 bg-emerald-300/[0.05]',
    red: 'border-red-400/20 bg-red-400/[0.05]',
  };
  const hasPad = /(?:^|\s)(p-|px-|py-)/.test(className);
  return (
    <div
      className={cx(
        'rounded-xl border',
        tones[tone],
        hasPad ? '' : 'p-4',
        interactive && 'transition duration-150 hover:border-cyan-300/25 hover:bg-white/[0.05]',
        className,
      )}
    >
      {children}
    </div>
  );
}

export function Panel({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <div className={cx('flex min-h-0 min-w-0 flex-col border-white/[0.07]', className)}>{children}</div>
  );
}

export function PanelHeader({
  title,
  children,
  className = '',
}: {
  title: ReactNode;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cx(
        'flex h-11 shrink-0 items-center justify-between gap-3 border-b border-white/[0.07] px-3',
        className,
      )}
    >
      <span className="truncate text-[10px] font-semibold uppercase tracking-[0.16em] text-gray-500">
        {title}
      </span>
      {children && <div className="flex shrink-0 items-center gap-1">{children}</div>}
    </div>
  );
}

export function Eyebrow({
  children,
  tone = 'cyan',
}: {
  children: ReactNode;
  tone?: 'cyan' | 'violet' | 'amber' | 'gray';
}) {
  const tones = {
    cyan: 'text-cyan-300/80',
    violet: 'text-violet-300/80',
    amber: 'text-amber-300/80',
    gray: 'text-gray-500',
  };
  return (
    <p className={cx('text-[10px] font-semibold uppercase tracking-[0.22em]', tones[tone])}>{children}</p>
  );
}

export function Divider({ className = '' }: { className?: string }) {
  return <div className={cx('h-px bg-white/[0.07]', className)} />;
}

/* ── Badge / status ───────────────────────────────────────────────── */

export type BadgeTone = 'gray' | 'cyan' | 'violet' | 'amber' | 'emerald' | 'red';

const BADGE_TONES: Record<BadgeTone, string> = {
  gray: 'border-white/[0.08] bg-white/[0.05] text-gray-400',
  cyan: 'border-cyan-300/20 bg-cyan-300/[0.1] text-cyan-200',
  violet: 'border-violet-300/20 bg-violet-300/[0.1] text-violet-200',
  amber: 'border-amber-300/20 bg-amber-300/[0.1] text-amber-200',
  emerald: 'border-emerald-300/20 bg-emerald-300/[0.1] text-emerald-200',
  red: 'border-red-400/20 bg-red-400/[0.1] text-red-200',
};

export function Badge({
  children,
  tone = 'gray',
  dot = false,
  pulse = false,
  className = '',
}: {
  children: ReactNode;
  tone?: BadgeTone;
  dot?: boolean;
  pulse?: boolean;
  className?: string;
}) {
  return (
    <span
      className={cx(
        'inline-flex shrink-0 items-center gap-1.5 rounded-md border px-2 py-0.5 text-[10px] font-medium',
        BADGE_TONES[tone],
        className,
      )}
    >
      {dot && <span className={cx('h-1.5 w-1.5 rounded-full bg-current', pulse && 'animate-pulse')} />}
      {children}
    </span>
  );
}

/** Task status → tone. One mapping, used by every surface. */
export const STATUS_TONE: Record<string, BadgeTone> = {
  pending: 'gray',
  running: 'cyan',
  planned: 'amber',
  awaiting_decision: 'violet',
  completed: 'emerald',
  failed: 'red',
};

export const STATUS_LABEL: Record<string, string> = {
  pending: 'queued',
  running: 'running',
  planned: 'awaiting approval',
  awaiting_decision: 'needs your choice',
  completed: 'completed',
  failed: 'failed',
};

export function StatusBadge({ status, className = '' }: { status: string; className?: string }) {
  const tone = STATUS_TONE[status] ?? 'gray';
  return (
    <Badge tone={tone} dot pulse={status === 'running'} className={className}>
      {STATUS_LABEL[status] ?? status}
    </Badge>
  );
}

/* ── Form controls ────────────────────────────────────────────────── */

function FieldShell({
  label,
  hint,
  error,
  htmlFor,
  children,
}: {
  label?: string;
  hint?: string;
  error?: string;
  htmlFor?: string;
  children: ReactNode;
}) {
  return (
    <div className="min-w-0">
      {label && (
        <label htmlFor={htmlFor} className="mb-1.5 block text-[11px] font-medium text-gray-400">
          {label}
        </label>
      )}
      {children}
      {error ? (
        <p className="mt-1.5 text-[11px] text-red-300">{error}</p>
      ) : (
        hint && <p className="mt-1.5 text-[11px] leading-4 text-gray-600">{hint}</p>
      )}
    </div>
  );
}

const CONTROL_BASE =
  'w-full rounded-lg border border-white/10 bg-[#0c1320]/80 px-3 text-[13px] text-gray-100 transition ' +
  'placeholder:text-gray-600 ' +
  'focus:border-cyan-300/50 focus:bg-[#0f192a] focus:outline-none focus:ring-4 focus:ring-cyan-300/[0.08] ' +
  'disabled:cursor-not-allowed disabled:opacity-50';

export const Input = forwardRef<
  HTMLInputElement,
  InputHTMLAttributes<HTMLInputElement> & { label?: string; hint?: string; error?: string }
>(function Input({ label, hint, error, className = '', id, ...props }, ref) {
  const autoId = useId();
  const fieldId = id ?? autoId;
  return (
    <FieldShell label={label} hint={hint} error={error} htmlFor={fieldId}>
      <input
        ref={ref}
        id={fieldId}
        aria-invalid={error ? true : undefined}
        className={cx(CONTROL_BASE, 'h-9', error && 'border-red-400/40', className)}
        {...props}
      />
    </FieldShell>
  );
});

export const Textarea = forwardRef<
  HTMLTextAreaElement,
  TextareaHTMLAttributes<HTMLTextAreaElement> & { label?: string; hint?: string; error?: string }
>(function Textarea({ label, hint, error, className = '', id, ...props }, ref) {
  const autoId = useId();
  const fieldId = id ?? autoId;
  return (
    <FieldShell label={label} hint={hint} error={error} htmlFor={fieldId}>
      <textarea
        ref={ref}
        id={fieldId}
        aria-invalid={error ? true : undefined}
        className={cx(CONTROL_BASE, 'resize-none py-2.5 leading-6', error && 'border-red-400/40', className)}
        {...props}
      />
    </FieldShell>
  );
});

export const Select = forwardRef<
  HTMLSelectElement,
  SelectHTMLAttributes<HTMLSelectElement> & { label?: string; hint?: string; error?: string }
>(function Select({ label, hint, error, className = '', id, children, ...props }, ref) {
  const autoId = useId();
  const fieldId = id ?? autoId;
  return (
    <FieldShell label={label} hint={hint} error={error} htmlFor={fieldId}>
      <select
        ref={ref}
        id={fieldId}
        className={cx(CONTROL_BASE, 'h-9 cursor-pointer appearance-none pr-8', className)}
        {...props}
      >
        {children}
      </select>
    </FieldShell>
  );
});

/* ── Tabs ─────────────────────────────────────────────────────────── */

export interface TabItem {
  id: string;
  label: string;
  hint?: string;
  count?: number;
  disabled?: boolean;
}

export function Tabs({
  items,
  active,
  onChange,
  className = '',
}: {
  items: TabItem[];
  active: string;
  onChange: (id: string) => void;
  className?: string;
}) {
  return (
    <div role="tablist" className={cx('flex items-center gap-0.5', className)}>
      {items.map((item, index) => {
        const isActive = item.id === active;
        return (
          <button
            key={item.id}
            role="tab"
            aria-selected={isActive}
            disabled={item.disabled}
            onClick={() => onChange(item.id)}
            title={item.hint}
            className={cx(
              'group relative inline-flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-[12px] font-medium transition',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/50',
              'disabled:pointer-events-none disabled:opacity-30',
              isActive ? 'bg-white/[0.08] text-white' : 'text-gray-500 hover:bg-white/[0.04] hover:text-gray-300',
            )}
          >
            {item.label}
            {typeof item.count === 'number' && item.count > 0 && (
              <span
                className={cx(
                  'rounded px-1 text-[10px] tabular-nums',
                  isActive ? 'bg-cyan-300/20 text-cyan-100' : 'bg-white/[0.07] text-gray-500',
                )}
              >
                {item.count}
              </span>
            )}
            <KeyHint keys={[`${index + 1}`]} className="ml-0.5 opacity-0 transition group-hover:opacity-100" />
          </button>
        );
      })}
    </div>
  );
}

/* ── Keyboard hint ────────────────────────────────────────────────── */

export function KeyHint({ keys, className = '' }: { keys: string[]; className?: string }) {
  return (
    <span className={cx('inline-flex shrink-0 items-center gap-0.5', className)} aria-hidden="true">
      {keys.map((key) => (
        <kbd
          key={key}
          className="rounded border border-white/10 bg-white/[0.05] px-1 py-px font-sans text-[9px] font-semibold leading-[1.4] text-gray-500"
        >
          {key}
        </kbd>
      ))}
    </span>
  );
}

/** Platform-aware modifier label. Rendered client-side only. */
export function useModKey(): string {
  const [mod, setMod] = useState('Ctrl');
  useEffect(() => {
    if (/Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent)) setMod('⌘');
  }, []);
  return mod;
}

/* ── Empty state ──────────────────────────────────────────────────── */

export function EmptyState({
  icon,
  title,
  description,
  action,
  className = '',
}: {
  icon?: ReactNode;
  title: string;
  description?: string;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cx('flex flex-col items-center justify-center px-6 py-12 text-center', className)}>
      {icon && (
        <div className="mb-4 flex h-11 w-11 items-center justify-center rounded-xl border border-white/[0.08] bg-white/[0.03] text-gray-500">
          {icon}
        </div>
      )}
      <p className="text-sm font-semibold text-gray-200">{title}</p>
      {description && <p className="mt-1.5 max-w-sm text-[12px] leading-5 text-gray-500">{description}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

/* ── Skeleton ─────────────────────────────────────────────────────── */

export function Skeleton({ className = '' }: { className?: string }) {
  return <div className={cx('animate-pulse rounded-md bg-white/[0.05]', className)} />;
}

/* ── Metric ───────────────────────────────────────────────────────── */

export function Metric({
  label,
  value,
  detail,
  tone = 'default',
}: {
  label: string;
  value: ReactNode;
  detail?: string;
  tone?: 'default' | 'warn' | 'danger';
}) {
  const tones = {
    default: 'text-gray-100',
    warn: 'text-amber-300',
    danger: 'text-red-300',
  };
  return (
    <div className="rounded-lg border border-white/[0.07] bg-black/20 px-3 py-2.5">
      <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-gray-600">{label}</p>
      <p className={cx('mt-1 text-lg font-semibold tabular-nums tracking-tight', tones[tone])}>{value}</p>
      {detail && <p className="mt-0.5 text-[10px] text-gray-600">{detail}</p>}
    </div>
  );
}

/* ── Meter (context usage, quotas) ────────────────────────────────── */

export function Meter({
  value,
  label,
  detail,
  warnAt = 70,
  dangerAt = 90,
}: {
  value: number;
  label?: string;
  detail?: string;
  warnAt?: number;
  dangerAt?: number;
}) {
  const pct = Math.max(0, Math.min(100, value));
  const tone = pct >= dangerAt ? 'red' : pct >= warnAt ? 'amber' : 'cyan';
  const bar = { cyan: 'bg-cyan-300/70', amber: 'bg-amber-300/80', red: 'bg-red-400/80' }[tone];
  const text = { cyan: 'text-gray-400', amber: 'text-amber-300', red: 'text-red-300' }[tone];
  return (
    <div title={detail}>
      {label && (
        <div className="mb-1 flex items-baseline justify-between gap-2">
          <span className="text-[10px] font-medium uppercase tracking-[0.12em] text-gray-600">{label}</span>
          <span className={cx('text-[11px] font-semibold tabular-nums', text)}>{Math.round(pct)}%</span>
        </div>
      )}
      <div className="h-1 overflow-hidden rounded-full bg-white/[0.07]">
        <div className={cx('h-full rounded-full transition-all duration-500', bar)} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

/* ── Dialog ───────────────────────────────────────────────────────── */

export function Dialog({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  width = 'md',
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children?: ReactNode;
  footer?: ReactNode;
  width?: 'sm' | 'md' | 'lg';
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;
  const widths = { sm: 'max-w-sm', md: 'max-w-lg', lg: 'max-w-2xl' };

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto p-4 pt-[10vh]">
      <button
        type="button"
        aria-label="Close dialog"
        onClick={onClose}
        className="fixed inset-0 cursor-default bg-black/60 backdrop-blur-sm"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={cx(
          'relative w-full rounded-2xl border border-white/10 bg-[#111a2b] shadow-[0_32px_90px_rgba(0,0,0,0.5)]',
          widths[width],
        )}
      >
        <div className="flex items-start justify-between gap-4 border-b border-white/[0.07] px-5 py-4">
          <div className="min-w-0">
            <h2 className="text-sm font-semibold text-white">{title}</h2>
            {description && <p className="mt-1 text-[12px] leading-5 text-gray-500">{description}</p>}
          </div>
          <IconButton label="Close" onClick={onClose}>
            <span aria-hidden="true" className="text-base leading-none">×</span>
          </IconButton>
        </div>
        {children && <div className="px-5 py-4">{children}</div>}
        {footer && (
          <div className="flex items-center justify-end gap-2 border-t border-white/[0.07] px-5 py-3.5">{footer}</div>
        )}
      </div>
    </div>
  );
}

/* ── Toast ────────────────────────────────────────────────────────── */

export interface Toast {
  id: number;
  tone: 'info' | 'success' | 'error';
  message: string;
}

interface ToastApi {
  push: (tone: Toast['tone'], message: string) => void;
}

const ToastContext = createContext<ToastApi>({ push: () => {} });

export function useToast(): ToastApi {
  return useContext(ToastContext);
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const push = (tone: Toast['tone'], message: string) => {
    const id = Date.now() + Math.random();
    setToasts((prev) => [...prev.slice(-3), { id, tone, message }]);
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 4500);
  };

  const tones = {
    info: 'border-white/10 bg-[#141d2f] text-gray-200',
    success: 'border-emerald-300/25 bg-emerald-300/[0.1] text-emerald-100',
    error: 'border-red-400/25 bg-red-400/[0.1] text-red-100',
  };

  return (
    <ToastContext.Provider value={{ push }}>
      {children}
      <div className="pointer-events-none fixed bottom-4 right-4 z-[60] flex w-[min(22rem,calc(100vw-2rem))] flex-col gap-2">
        {toasts.map((toast) => (
          <div
            key={toast.id}
            role="status"
            className={cx(
              'pointer-events-auto rounded-lg border px-3.5 py-2.5 text-[12px] leading-5 shadow-[0_16px_40px_rgba(0,0,0,0.4)] backdrop-blur-md',
              tones[toast.tone],
            )}
          >
            {toast.message}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

/* ── Inline alert ─────────────────────────────────────────────────── */

export function Alert({
  tone = 'info',
  title,
  children,
  action,
}: {
  tone?: 'info' | 'warn' | 'error' | 'success';
  title?: string;
  children?: ReactNode;
  action?: ReactNode;
}) {
  const tones = {
    info: 'border-white/[0.08] bg-white/[0.03] text-gray-300',
    warn: 'border-amber-300/20 bg-amber-300/[0.06] text-amber-100',
    error: 'border-red-400/20 bg-red-400/[0.07] text-red-100',
    success: 'border-emerald-300/20 bg-emerald-300/[0.06] text-emerald-100',
  };
  return (
    <div role={tone === 'error' ? 'alert' : 'status'} className={cx('rounded-lg border px-3.5 py-3', tones[tone])}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 text-[12px] leading-5">
          {title && <p className="font-semibold">{title}</p>}
          {children && <div className={title ? 'mt-0.5 opacity-90' : ''}>{children}</div>}
        </div>
        {action && <div className="shrink-0">{action}</div>}
      </div>
    </div>
  );
}
