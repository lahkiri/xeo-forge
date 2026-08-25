/**
 * Inline stroke icons (Lucide geometry, MIT) — replaces unicode glyph "icons"
 * (▶ ↗ ⌁ ◇ ⌄) that read as placeholders. No dependency: each icon is a small
 * inline SVG with currentColor strokes, sized via the `size` prop.
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

/** Play — start / run actions. Replaces "▶". */
export function IconPlay({ size, ...rest }: IconProps) {
  return (
    <Base size={size} {...rest}>
      <polygon points="6 3 20 12 6 21 6 3" />
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

/** Zap — energy / execution. Replaces "⌁". */
export function IconZap({ size, ...rest }: IconProps) {
  return (
    <Base size={size} {...rest}>
      <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
    </Base>
  );
}

/** Diamond — idea / shape. Replaces "◇". */
export function IconDiamond({ size, ...rest }: IconProps) {
  return (
    <Base size={size} {...rest}>
      <path d="M2.7 10.3a2.41 2.41 0 0 0 0 3.4l7.6 7.6a2.41 2.41 0 0 0 3.4 0l7.6-7.6a2.41 2.41 0 0 0 0-3.4l-7.6-7.6a2.41 2.41 0 0 0-3.4 0Z" />
    </Base>
  );
}

/** ChevronDown — dropdown affordance. Replaces "⌄". */
export function IconChevronDown({ size, ...rest }: IconProps) {
  return (
    <Base size={size} {...rest}>
      <path d="m6 9 6 6 6-6" />
    </Base>
  );
}

/** Check — selection state. Replaces "✓". */
export function IconCheck({ size, ...rest }: IconProps) {
  return (
    <Base size={size} {...rest}>
      <path d="M20 6 9 17l-5-5" />
    </Base>
  );
}

/** SquareTerminal — command/terminal contexts. Replaces "⌘"-style glyphs. */
export function IconTerminal({ size, ...rest }: IconProps) {
  return (
    <Base size={size} {...rest}>
      <polyline points="4 17 10 11 4 5" />
      <line x1="12" x2="20" y1="19" y2="19" />
    </Base>
  );
}
