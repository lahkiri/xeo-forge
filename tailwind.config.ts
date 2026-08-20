import type { Config } from 'tailwindcss';

/**
 * Xeo Forge design tokens.
 *
 * WHY THIS EXISTS: `theme.extend` was empty, so every colour, size, radius and
 * shadow in the app was an arbitrary Tailwind value chosen per component
 * (`text-[11px]`, `bg-white/[0.035]`, `border-white/[0.07]`…). There was no
 * system to design with, which is why the interface read as inconsistent in its
 * details even where the structure was sound.
 *
 * The palette is built for an operations console, not a marketing page:
 *  - `ink`    surfaces, from the app background up through raised panels
 *  - `line`   borders, three weights only
 *  - `text`   four content levels, so hierarchy is a choice not an accident
 *  - `signal` semantic state — the ONLY place hue carries meaning
 *
 * Semantic naming is deliberate. `signal-run` and `signal-gate` say what the
 * colour means, so a component cannot accidentally use "success green" for a
 * pending state.
 */
const config: Config = {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        /* Surfaces — deep, slightly blue, never pure black. */
        ink: {
          900: '#070b12', // app background, header
          800: '#0b1220', // primary surface
          700: '#0f1725', // raised panel
          600: '#141d2e', // dialog, popover
          500: '#1a2436', // hover on raised
        },
        /* Borders. Three weights is enough for any interface. */
        line: {
          subtle: 'rgba(180, 205, 230, 0.07)',
          DEFAULT: 'rgba(180, 205, 230, 0.12)',
          strong: 'rgba(180, 205, 230, 0.20)',
        },
        /* Content hierarchy. */
        content: {
          primary: '#e8edf5', // headings, active values
          secondary: '#9aa7bd', // body
          muted: '#67748c', // labels, metadata
          faint: '#44506680', // disabled, decorative
        },
        /* Semantic state. Hue means something here and nowhere else. */
        signal: {
          run: '#67e8f9', // executing, active, live
          gate: '#fbbf24', // awaiting a human decision
          pass: '#4ade80', // verified, succeeded, allowed
          fail: '#f87171', // failed, denied
          plan: '#a78bfa', // planning, governed mode
        },
      },
      /* Type ramp. Named steps stop ad-hoc `text-[11px]` choices. */
      fontSize: {
        micro: ['0.625rem', { lineHeight: '0.875rem', letterSpacing: '0.12em' }], // 10px — labels
        meta: ['0.6875rem', { lineHeight: '1rem' }], // 11px — metadata
        ui: ['0.75rem', { lineHeight: '1.125rem' }], // 12px — dense UI
        body: ['0.8125rem', { lineHeight: '1.5rem' }], // 13px — reading
        title: ['0.9375rem', { lineHeight: '1.375rem' }], // 15px — section
        display: ['1.375rem', { lineHeight: '1.75rem', letterSpacing: '-0.01em' }], // 22px
      },
      fontFamily: {
        sans: ['ui-sans-serif', 'system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'sans-serif'],
        mono: ['ui-monospace', 'SF Mono', 'Cascadia Code', 'Fira Code', 'monospace'],
      },
      borderRadius: {
        control: '0.5rem', // buttons, inputs
        panel: '0.75rem', // cards, panels
        modal: '1rem', // dialogs
      },
      spacing: {
        /* Fixed chrome dimensions, so panes line up across surfaces. */
        header: '3.5rem',
        pane: '2.75rem',
        rail: '17rem',
        nav: '14rem',
      },
      boxShadow: {
        raised: '0 1px 2px rgba(0, 0, 0, 0.3)',
        panel: '0 8px 24px -8px rgba(0, 0, 0, 0.4)',
        modal: '0 24px 64px -12px rgba(0, 0, 0, 0.6)',
        /* Focus ring as a shadow so it composes with borders. */
        focus: '0 0 0 3px rgba(103, 232, 249, 0.16)',
      },
      transitionDuration: {
        instant: '80ms', // hover, press
        quick: '140ms', // state change
        panel: '220ms', // layout
      },
      keyframes: {
        'live-pulse': {
          '0%, 100%': { opacity: '1' },
          '50%': { opacity: '0.35' },
        },
        'panel-in': {
          from: { opacity: '0', transform: 'translateY(4px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
        'row-in': {
          from: { opacity: '0', transform: 'translateX(-4px)' },
          to: { opacity: '1', transform: 'translateX(0)' },
        },
      },
      animation: {
        /* Reserved for genuinely live state. Never decorative. */
        'live-pulse': 'live-pulse 1.6s ease-in-out infinite',
        'panel-in': 'panel-in 220ms cubic-bezier(0.16, 1, 0.3, 1)',
        'row-in': 'row-in 180ms cubic-bezier(0.16, 1, 0.3, 1)',
      },
    },
  },
  plugins: [],
};

export default config;
