/**
 * Inline stroke icons (Lucide geometry, MIT) — the single professional icon
 * set for every surface. Replaces all unicode glyph "icons" (← → ⌘ ⚙ ◇ ◈ ◎
 * ⊕ ◌ ⌕ ‹ › × ▶ ✓ ✕ ○ ◆ ▲ ▼ ☀ ☾ ⌗ •••) that read as placeholders and broke
 * visual consistency between the workspace, settings, and live run views.
 *
 * No dependency: each icon is a small inline SVG with currentColor strokes,
 * sized via the `size` prop, inheriting color from the text token of its
 * container so light/dark themes stay correct.
 */

import type { SVGProps } from 'react';

type IconProps = SVGProps<SVGSVGElement> & { size?: number };

function Base({ size = 14, children, ...rest }: IconProps & { children: React.ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...rest}
    >
      {children}
    </svg>
  );
}

/* ── Direction ──────────────────────────────────────────────────── */

/** ArrowLeft — back links ("Workspace"). Replaces "←". */
export function IconArrowLeft({ size, ...rest }: IconProps) {
  return (
    <Base size={size} {...rest}>
      <path d="m12 19-7-7 7-7" />
      <path d="M19 12H5" />
    </Base>
  );
}

/** ArrowUpRight — open / navigate. Replaces "↗". */
export function IconArrowUpRight({ size, ...rest }: IconProps) {
  return (
    <Base size={size} {...rest}>
      <path d="M7 17 17 7" />
      <path d="M7 7h10v10" />
    </Base>
  );
}

/** ArrowRight — forward affordance ("Switch to Work", submit). Replaces "→". */
export function IconArrowRight({ size, ...rest }: IconProps) {
  return (
    <Base size={size} {...rest}>
      <path d="M5 12h14" />
      <path d="m12 5 7 7-7 7" />
    </Base>
  );
}

/** ChevronRight — disclosure into a detail view. Replaces "›" and "▶". */
export function IconChevronRight({ size, ...rest }: IconProps) {
  return (
    <Base size={size} {...rest}>
      <path d="m9 18 6-6-6-6" />
    </Base>
  );
}

/** ChevronDown — dropdown / expand affordance. Replaces "⌄" and "▼". */
export function IconChevronDown({ size, ...rest }: IconProps) {
  return (
    <Base size={size} {...rest}>
      <path d="m6 9 6 6 6-6" />
    </Base>
  );
}

/** PanelLeftClose — collapse the sidebar. Replaces "‹". */
export function IconPanelLeftClose({ size, ...rest }: IconProps) {
  return (
    <Base size={size} {...rest}>
      <rect width="18" height="18" x="3" y="3" rx="2" />
      <path d="M9 3v18" />
      <path d="m16 15-3-3 3-3" />
    </Base>
  );
}

/** PanelLeftOpen — expand the sidebar. Replaces "› Show sidebar". */
export function IconPanelLeftOpen({ size, ...rest }: IconProps) {
  return (
    <Base size={size} {...rest}>
      <rect width="18" height="18" x="3" y="3" rx="2" />
      <path d="M9 3v18" />
      <path d="m14 9 3 3-3 3" />
    </Base>
  );
}

/* ── Objects & surfaces ─────────────────────────────────────────── */

/** Search — find / command palette. Replaces "⌕". */
export function IconSearch({ size, ...rest }: IconProps) {
  return (
    <Base size={size} {...rest}>
      <circle cx="11" cy="11" r="8" />
      <path d="m21 21-4.3-4.3" />
    </Base>
  );
}

/** MessageCircle — chat sessions. Replaces "◌". */
export function IconMessageCircle({ size, ...rest }: IconProps) {
  return (
    <Base size={size} {...rest}>
      <path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z" />
    </Base>
  );
}

/** Folder — work sessions / projects. Replaces "⌘" in session rows. */
export function IconFolder({ size, ...rest }: IconProps) {
  return (
    <Base size={size} {...rest}>
      <path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z" />
    </Base>
  );
}

/** Settings — the gear. Replaces "⚙" and "◈". */
export function IconSettings({ size, ...rest }: IconProps) {
  return (
    <Base size={size} {...rest}>
      <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
      <circle cx="12" cy="12" r="3" />
    </Base>
  );
}

/** UserRound — profiles / agent roles. Replaces "◎". */
export function IconUserRound({ size, ...rest }: IconProps) {
  return (
    <Base size={size} {...rest}>
      <circle cx="12" cy="8" r="5" />
      <path d="M20 21a8 8 0 0 0-16 0" />
    </Base>
  );
}

/** Plug — external tool integrations (MCP). Replaces "⊕". */
export function IconPlug({ size, ...rest }: IconProps) {
  return (
    <Base size={size} {...rest}>
      <path d="M12 22v-5" />
      <path d="M9 8V2" />
      <path d="M15 8V2" />
      <path d="M18 8v5a4 4 0 0 1-4 4h-4a4 4 0 0 1-4-4V8Z" />
    </Base>
  );
}

/** Command — the mod key / command surface. Replaces decorative "⌘". */
export function IconCommand({ size, ...rest }: IconProps) {
  return (
    <Base size={size} {...rest}>
      <path d="M15 6v12a3 3 0 1 0 3-3H6a3 3 0 1 0 3 3V6a3 3 0 1 0-3 3h12a3 3 0 1 0-3-3" />
    </Base>
  );
}

/** Sparkles — assistant presence / openers. Replaces "✦". */
export function IconSparkles({ size, ...rest }: IconProps) {
  return (
    <Base size={size} {...rest}>
      <path d="M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z" />
      <path d="M20 3v4" />
      <path d="M22 5h-4" />
    </Base>
  );
}

/* ── Actions & states ───────────────────────────────────────────── */

/** Play — start / run actions. Replaces "▶". */
export function IconPlay({ size, ...rest }: IconProps) {
  return (
    <Base size={size} {...rest}>
      <polygon points="6 3 20 12 6 21 6 3" />
    </Base>
  );
}

/** Square — stop a running stream. */
export function IconSquare({ size, ...rest }: IconProps) {
  return (
    <Base size={size} {...rest}>
      <rect width="12" height="12" x="6" y="6" rx="1.5" />
    </Base>
  );
}

/** Minus — window minimize (desktop titlebar). */
export function IconMinus({ size, ...rest }: IconProps) {
  return (
    <Base size={size} {...rest}>
      <path d="M5 12h14" />
    </Base>
  );
}

/** Plus — create. Replaces "+" in icon buttons. */
export function IconPlus({ size, ...rest }: IconProps) {
  return (
    <Base size={size} {...rest}>
      <path d="M5 12h14" />
      <path d="M12 5v14" />
    </Base>
  );
}

/** X — dismiss / remove / failure. Replaces "×" and "✕". */
export function IconX({ size, ...rest }: IconProps) {
  return (
    <Base size={size} {...rest}>
      <path d="M18 6 6 18" />
      <path d="m6 6 12 12" />
    </Base>
  );
}

/** Check — selection / success. Replaces "✓". */
export function IconCheck({ size, ...rest }: IconProps) {
  return (
    <Base size={size} {...rest}>
      <path d="M20 6 9 17l-5-5" />
    </Base>
  );
}

/** CircleSmall — neutral / off state dot. Replaces "○". */
export function IconCircle({ size, ...rest }: IconProps) {
  return (
    <Base size={size} {...rest}>
      <circle cx="12" cy="12" r="9" />
    </Base>
  );
}

/** HelpCircle — honestly unknown state. Replaces "?". */
export function IconHelpCircle({ size, ...rest }: IconProps) {
  return (
    <Base size={size} {...rest}>
      <circle cx="12" cy="12" r="10" />
      <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
      <path d="M12 17h.01" />
    </Base>
  );
}

/** Zap — energy / execution. Replaces "⌁". */
export function IconZap({ size, ...rest }: IconProps) {
  return (
    <Base size={size} {...rest}>
      <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
    </Base>
  );
}

/** Diamond — idea / shape / thinking. Replaces "◇" and "◆". */
export function IconDiamond({ size, ...rest }: IconProps) {
  return (
    <Base size={size} {...rest}>
      <path d="M2.7 10.3a2.41 2.41 0 0 0 0 3.4l7.6 7.6a2.41 2.41 0 0 0 3.4 0l7.6-7.6a2.41 2.41 0 0 0 0-3.4l-7.6-7.6a2.41 2.41 0 0 0-3.4 0Z" />
    </Base>
  );
}

/** SquareTerminal — command/terminal contexts. */
export function IconTerminal({ size, ...rest }: IconProps) {
  return (
    <Base size={size} {...rest}>
      <polyline points="4 17 10 11 4 5" />
      <line x1="12" x2="20" y1="19" y2="19" />
    </Base>
  );
}

/** MoreHorizontal — overflow / account menu. Replaces "•••". */

/* ── Appearance ─────────────────────────────────────────────────── */

/** Sun — light theme. Replaces "☀". */
export function IconSun({ size, ...rest }: IconProps) {
  return (
    <Base size={size} {...rest}>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2" />
      <path d="M12 20v2" />
      <path d="m4.93 4.93 1.41 1.41" />
      <path d="m17.66 17.66 1.41 1.41" />
      <path d="M2 12h2" />
      <path d="M20 12h2" />
      <path d="m6.34 17.66-1.41 1.41" />
      <path d="m19.07 4.93-1.41 1.41" />
    </Base>
  );
}

/** Moon — dark theme. Replaces "☾". */
export function IconMoon({ size, ...rest }: IconProps) {
  return (
    <Base size={size} {...rest}>
      <path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z" />
    </Base>
  );
}

/** Monitor — match-system theme. Replaces "⌗". */
export function IconMonitor({ size, ...rest }: IconProps) {
  return (
    <Base size={size} {...rest}>
      <rect width="20" height="14" x="2" y="3" rx="2" />
      <line x1="8" x2="16" y1="21" y2="21" />
      <line x1="12" x2="12" y1="17" y2="21" />
    </Base>
  );
}
