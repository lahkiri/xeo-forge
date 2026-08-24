import type { Config } from 'tailwindcss';

/**
 * Xeo Forge design tokens.
 *
 * Calibrated for an operations console, not a marketing page. Two themes share
 * one token vocabulary via CSS variables declared in globals.css, so every
 * component is theme-agnostic — a component never branches on light/dark.
 *
 *  - `ink`     surfaces, from app background up through dialogs
 *  - `line`    borders, three weights only
 *  - `content` four content levels, so hierarchy is a choice not an accident
 *  - `signal`  semantic state — the ONLY place hue carries meaning
 *
 * Semantic naming is deliberate. `signal-run` and `signal-gate` say what the
 * colour means, so a component cannot use "success green" for a pending state.
 */
const config: Config = {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'],
  darkMode: ['class', '[data-theme="dark"]'],
  theme: {
    extend: {
      colors: {
        ink: {
          900: 'rgb(var(--ink-900) / <alpha-value>)',
          800: 'rgb(var(--ink-800) / <alpha-value>)',
          700: 'rgb(var(--ink-700) / <alpha-value>)',
          600: 'rgb(var(--ink-600) / <alpha-value>)',
          500: 'rgb(var(--ink-500) / <alpha-value>)',
        },
        line: {
          subtle: 'rgb(var(--line-subtle) / <alpha-value>)',
          DEFAULT: 'rgb(var(--line) / <alpha-value>)',
          strong: 'rgb(var(--line-strong) / <alpha-value>)',
        },
        content: {
          primary: 'rgb(var(--content-primary) / <alpha-value>)',
          secondary: 'rgb(var(--content-secondary) / <alpha-value>)',
          muted: 'rgb(var(--content-muted) / <alpha-value>)',
          faint: 'rgb(var(--content-faint) / <alpha-value>)',
        },
        signal: {
          run: 'rgb(var(--signal-run) / <alpha-value>)',
          gate: 'rgb(var(--signal-gate) / <alpha-value>)',
          pass: 'rgb(var(--signal-pass) / <alpha-value>)',
          fail: 'rgb(var(--signal-fail) / <alpha-value>)',
          plan: 'rgb(var(--signal-plan) / <alpha-value>)',
        },
        /** Text that sits on a filled signal surface. Flips per theme. */
        'on-signal': 'rgb(var(--on-signal) / <alpha-value>)',
      },
      /* Type ramp. Named steps stop ad-hoc `text-[11px]` choices.
         Calibrated up one notch from the first pass: 10px labels were
         illegible in the rail at 1440px. */
      fontSize: {
        micro: ['0.6875rem', { lineHeight: '0.9375rem', letterSpacing: '0.1em' }], // 11 labels
        meta: ['0.75rem', { lineHeight: '1.0625rem' }], // 12 metadata
        ui: ['0.8125rem', { lineHeight: '1.1875rem' }], // 13 dense UI
        body: ['0.875rem', { lineHeight: '1.5625rem' }], // 14 reading
        title: ['1rem', { lineHeight: '1.4375rem', letterSpacing: '-0.005em' }], // 16 section
        display: ['1.5rem', { lineHeight: '1.875rem', letterSpacing: '-0.015em' }], // 24
      },
      fontFamily: {
        sans: ['ui-sans-serif', 'system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'sans-serif'],
        mono: ['ui-monospace', 'SF Mono', 'Cascadia Code', 'Fira Code', 'monospace'],
      },
      borderRadius: {
        control: '0.375rem', // buttons, inputs — tighter reads as tooling
        panel: '0.625rem',
        modal: '0.875rem',
      },
      spacing: {
        header: '3rem', // 48px, was 56 — reclaim vertical for the workbench
        pane: '2.5rem',
        rail: '18rem',
        nav: '14rem',
      },
      boxShadow: {
        raised: '0 1px 2px rgb(var(--shadow-color) / 0.28)',
        panel: '0 10px 30px -12px rgb(var(--shadow-color) / 0.42)',
        modal: '0 28px 72px -16px rgb(var(--shadow-color) / 0.58)',
        focus: '0 0 0 3px rgb(var(--signal-run) / 0.22)',
      },
      transitionDuration: {
        instant: '80ms',
        quick: '140ms',
        panel: '220ms',
      },
      keyframes: {
        'live-pulse': {
          '0%, 100%': { opacity: '1' },
          '50%': { opacity: '0.3' },
        },
        'panel-in': {
          from: { opacity: '0', transform: 'translateY(4px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
        'row-in': {
          from: { opacity: '0', transform: 'translateX(-3px)' },
          to: { opacity: '1', transform: 'translateX(0)' },
        },
        'sweep': {
          '0%': { transform: 'translateX(-100%)' },
          '100%': { transform: 'translateX(100%)' },
        },
      },
      animation: {
        /* Reserved for genuinely live state. Never decorative. */
        'live-pulse': 'live-pulse 1.6s ease-in-out infinite',
        'panel-in': 'panel-in 220ms cubic-bezier(0.16, 1, 0.3, 1)',
        'row-in': 'row-in 180ms cubic-bezier(0.16, 1, 0.3, 1)',
        'sweep': 'sweep 1.8s ease-in-out infinite',
      },
    },
  },
  plugins: [],
};

export default config;
