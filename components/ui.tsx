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
import { IconX } from './icons';

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
  sm: 'h-7 gap-1.5 px-2.5 text-meta',
  md: 'h-8 gap-2 px-3 text-ui',
  lg: 'h-10 gap-2 px-4 text-body',
};

// Flat fills, no glow. A control that emits light reads as decorative; in an
// operations console the only thing that should draw the eye is live state.
const BUTTON_VARIANTS: Record<ButtonVariant, string> = {
  primary:
    'bg-signal-run text-ink-900 font-semibold hover:brightness-110 active:brightness-95',
  secondary:
    'border border-line bg-ink-600 text-content-primary hover:border-line-strong hover:bg-ink-500',
  ghost:
    'border border-transparent text-content-secondary hover:bg-ink-700 hover:text-content-primary',
  danger:
    'border border-signal-fail/30 bg-signal-fail/10 text-signal-fail hover:bg-signal-fail/20',
  success:
    'bg-signal-pass text-ink-900 font-semibold hover:brightness-110 active:brightness-95',
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
        'inline-flex shrink-0 items-center justify-center rounded-control font-medium transition-colors duration-instant',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal-run/60 focus-visible:ring-offset-1 focus-visible:ring-offset-ink-800',
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
        'inline-flex shrink-0 items-center justify-center rounded-control border border-transparent text-content-muted transition',
        'hover:bg-ink-600 hover:text-content-primary',
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
    default: 'border-line-subtle bg-ink-700/70',
    cyan: 'border-signal-run/20 bg-signal-run/05',
    violet: 'border-signal-plan/20 bg-signal-plan/05',
    amber: 'border-signal-gate/20 bg-signal-gate/05',
    emerald: 'border-signal-pass/20 bg-signal-pass/05',
    red: 'border-signal-fail/20 bg-signal-fail/05',
  };
  const hasPad = /(?:^|\s)(p-|px-|py-)/.test(className);
  return (
    <div
      className={cx(
        'rounded-panel border',
        tones[tone],
        hasPad ? '' : 'p-4',
        interactive && 'transition-colors duration-quick hover:border-line hover:bg-ink-700',
        className,
      )}
    >
      {children}
    </div>
  );
}

export function Panel({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <div className={cx('flex min-h-0 min-w-0 flex-col border-line-subtle', className)}>{children}</div>
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
        'flex h-11 shrink-0 items-center justify-between gap-3 border-b border-line-subtle px-3',
        className,
      )}
    >
      <span className="truncate text-micro font-semibold uppercase tracking-[0.16em] text-content-muted">
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
    cyan: 'text-signal-run/80',
    violet: 'text-signal-plan/80',
    amber: 'text-signal-gate/80',
    gray: 'text-content-muted',
  };
  return (
    <p className={cx('text-micro font-semibold uppercase tracking-[0.22em]', tones[tone])}>{children}</p>
  );
}

export function Divider({ className = '' }: { className?: string }) {
  return <div className={cx('h-px bg-ink-600', className)} />;
}

/* ── Badge / status ───────────────────────────────────────────────── */

export type BadgeTone = 'gray' | 'cyan' | 'violet' | 'amber' | 'emerald' | 'red';

// Borderless tinted chips. A badge with a border reads as a button and invites
// a click it does not accept.
const BADGE_TONES: Record<BadgeTone, string> = {
  gray: 'bg-ink-500 text-content-muted',
  cyan: 'bg-signal-run/15 text-signal-run',
  violet: 'bg-signal-plan/15 text-signal-plan',
  amber: 'bg-signal-gate/15 text-signal-gate',
  emerald: 'bg-signal-pass/15 text-signal-pass',
  red: 'bg-signal-fail/15 text-[rgb(var(--signal-fail))] font-medium',
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
        'inline-flex shrink-0 items-center gap-1.5 rounded-md border px-2 py-0.5 text-micro font-medium',
        BADGE_TONES[tone],
        className,
      )}
    >
      {dot && <span className={cx('h-1.5 w-1.5 rounded-full bg-current', pulse && 'animate-live-pulse')} />}
      {children}
    </span>
  );
}

/** Task status to tone mapping. One mapping, used by every surface. */
export const STATUS_TONE: Record<string, BadgeTone> = {
  pending: 'gray',
  running: 'cyan',
  planned: 'amber',
  awaiting_decision: 'violet',
  completed: 'emerald',
  failed: 'red',
  cancelled: 'gray',
};

export const STATUS_LABEL: Record<string, string> = {
  pending: 'queued',
  running: 'running',
  planned: 'awaiting approval',
  awaiting_decision: 'needs your choice',
  completed: 'completed',
  failed: 'failed',
  cancelled: 'cancelled',
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
        <label htmlFor={htmlFor} className="mb-1.5 block text-meta font-medium text-content-secondary">
          {label}
        </label>
      )}
      {children}
      {error ? (
        <p className="mt-1.5 text-meta text-signal-fail">{error}</p>
      ) : (
        hint && <p className="mt-1.5 text-meta leading-4 text-content-muted">{hint}</p>
      )}
    </div>
  );
}

const CONTROL_BASE =
  'w-full rounded-control border border-line bg-ink-900/60 px-3 text-ui text-content-primary ' +
  'transition-colors duration-quick placeholder:text-content-muted ' +
  'focus:border-signal-run/45 focus:bg-ink-700 focus:outline-none focus:shadow-focus ' +
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
        className={cx(CONTROL_BASE, 'h-9', error && 'border-signal-fail/40', className)}
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
        className={cx(CONTROL_BASE, 'resize-none py-2.5 leading-6', error && 'border-signal-fail/40', className)}
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
              'group relative inline-flex h-8 items-center gap-1.5 rounded-control px-2.5 text-ui font-medium transition',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/50',
              'disabled:pointer-events-none disabled:opacity-30',
              isActive ? 'bg-ink-600 text-content-primary' : 'text-content-muted hover:bg-ink-700 hover:text-content-secondary',
            )}
          >
            {item.label}
            {typeof item.count === 'number' && item.count > 0 && (
              <span
                className={cx(
                  'rounded px-1 text-micro tabular-nums',
                  isActive ? 'bg-signal-run/20 text-signal-run' : 'bg-ink-600 text-content-muted',
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
          className="rounded border border-line bg-ink-700 px-1 py-px font-sans text-micro font-semibold leading-[1.4] text-content-muted"
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
        <div className="mb-4 flex h-11 w-11 items-center justify-center rounded-panel border border-line-subtle bg-ink-700/60 text-content-muted">
          {icon}
        </div>
      )}
      <p className="text-ui font-semibold text-content-primary">{title}</p>
      {description && <p className="mt-1.5 max-w-sm text-ui leading-5 text-content-muted">{description}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

/* ── Skeleton ─────────────────────────────────────────────────────── */

export function Skeleton({ className = '' }: { className?: string }) {
  return <div className={cx('animate-live-pulse rounded-md bg-ink-700', className)} />;
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
    default: 'text-content-primary',
    warn: 'text-amber-300',
    danger: 'text-signal-fail',
  };
  return (
    <div className="rounded-control border border-line-subtle bg-black/20 px-3 py-2.5">
      <p className="text-micro font-semibold uppercase tracking-[0.14em] text-content-muted">{label}</p>
      <p className={cx('mt-1 text-title font-semibold tabular-nums tracking-tight', tones[tone])}>{value}</p>
      {detail && <p className="mt-0.5 text-micro text-content-muted">{detail}</p>}
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
  const bar = { cyan: 'bg-signal-run/70', amber: 'bg-signal-gate/80', red: 'bg-signal-fail/80' }[tone];
  const text = { cyan: 'text-content-secondary', amber: 'text-amber-300', red: 'text-signal-fail' }[tone];
  return (
    <div title={detail}>
      {label && (
        <div className="mb-1 flex items-baseline justify-between gap-2">
          <span className="text-micro font-medium uppercase tracking-[0.12em] text-content-muted">{label}</span>
          <span className={cx('text-meta font-semibold tabular-nums', text)}>{Math.round(pct)}%</span>
        </div>
      )}
      <div className="h-1 overflow-hidden rounded-full bg-ink-600">
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
          'relative w-full rounded-modal border border-line bg-ink-600 shadow-modal',
          widths[width],
        )}
      >
        <div className="flex items-start justify-between gap-4 border-b border-line-subtle px-5 py-4">
          <div className="min-w-0">
            <h2 className="text-ui font-semibold text-content-primary">{title}</h2>
            {description && <p className="mt-1 text-ui leading-5 text-content-muted">{description}</p>}
          </div>
          <IconButton label="Close" onClick={onClose}>
            <span aria-hidden="true" className="inline-flex leading-none"><IconX size={14} /></span>
          </IconButton>
        </div>
        {children && <div className="px-5 py-4">{children}</div>}
        {footer && (
          <div className="flex items-center justify-end gap-2 border-t border-line-subtle px-5 py-3.5">{footer}</div>
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
    info: 'border-line bg-ink-600 text-content-primary',
    success: 'border-signal-pass/25 bg-signal-pass/1 text-emerald-100',
    error: 'border-signal-fail/25 bg-signal-fail/1 text-signal-fail',
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
              'pointer-events-auto rounded-control border px-3.5 py-2.5 text-ui leading-5 shadow-panel backdrop-blur-md',
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
    info: 'border-line-subtle bg-ink-700/60 text-content-secondary',
    warn: 'border-signal-gate/20 bg-signal-gate/06 text-signal-gate',
    error: 'border-signal-fail/20 bg-signal-fail/07 text-signal-fail',
    success: 'border-signal-pass/20 bg-signal-pass/06 text-emerald-100',
  };
  return (
    <div role={tone === 'error' ? 'alert' : 'status'} className={cx('rounded-control border px-3.5 py-3', tones[tone])}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 text-ui leading-5">
          {title && <p className="font-semibold">{title}</p>}
          {children && <div className={title ? 'mt-0.5 opacity-90' : ''}>{children}</div>}
        </div>
        {action && <div className="shrink-0">{action}</div>}
      </div>
    </div>
  );
}
