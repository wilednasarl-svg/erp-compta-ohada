import type { Config } from 'tailwindcss';
import animate from 'tailwindcss-animate';

/**
 * Tailwind v3 configuration — Editorial paper-ivory direction.
 *
 * Tokens are OKLCH-based (see src/app/globals.css). Colors are exposed
 * both via shadcn-compatible semantic slots (background, foreground,
 * primary, ...) and direct named tokens (canvas, paper, ink, accent, ...)
 * so we can hand-craft non-shadcn surfaces without falling back to slate.
 */
const config: Config = {
  darkMode: ['class'],
  content: ['./src/app/**/*.{ts,tsx}', './src/components/**/*.{ts,tsx}', './src/lib/**/*.{ts,tsx}'],
  theme: {
    container: {
      center: true,
      padding: '1.5rem',
      screens: { '2xl': '1440px' },
    },
    extend: {
      colors: {
        /* Direct named tokens — preferred for new code */
        canvas: 'oklch(var(--canvas))',
        paper: 'oklch(var(--paper))',
        sunk: 'oklch(var(--sunk))',
        ink: {
          DEFAULT: 'oklch(var(--ink))',
          soft: 'oklch(var(--ink-soft))',
          mute: 'oklch(var(--ink-mute))',
        },
        line: {
          DEFAULT: 'oklch(var(--line))',
          strong: 'oklch(var(--line-strong))',
        },
        accent: {
          DEFAULT: 'oklch(var(--accent))',
          soft: 'oklch(var(--accent-soft))',
          ink: 'oklch(var(--accent-ink))',
        },
        critical: {
          DEFAULT: 'oklch(var(--critical))',
          soft: 'oklch(var(--critical-soft))',
          ink: 'oklch(var(--critical-ink))',
        },
        warn: {
          DEFAULT: 'oklch(var(--warn))',
          soft: 'oklch(var(--warn-soft))',
          ink: 'oklch(var(--warn-ink))',
        },
        info: {
          DEFAULT: 'oklch(var(--info))',
          soft: 'oklch(var(--info-soft))',
          ink: 'oklch(var(--info-ink))',
        },

        /* shadcn semantic slots — backward compat with existing primitives */
        border: 'oklch(var(--border))',
        input: 'oklch(var(--input))',
        ring: 'oklch(var(--ring))',
        background: 'oklch(var(--background))',
        foreground: 'oklch(var(--foreground))',
        primary: {
          DEFAULT: 'oklch(var(--primary))',
          foreground: 'oklch(var(--primary-foreground))',
        },
        secondary: {
          DEFAULT: 'oklch(var(--secondary))',
          foreground: 'oklch(var(--secondary-foreground))',
        },
        destructive: {
          DEFAULT: 'oklch(var(--destructive))',
          foreground: 'oklch(var(--destructive-foreground))',
        },
        muted: {
          DEFAULT: 'oklch(var(--muted))',
          foreground: 'oklch(var(--muted-foreground))',
        },
        card: {
          DEFAULT: 'oklch(var(--card))',
          foreground: 'oklch(var(--card-foreground))',
        },
        popover: {
          DEFAULT: 'oklch(var(--popover))',
          foreground: 'oklch(var(--popover-foreground))',
        },
      },
      fontFamily: {
        sans: ['var(--font-geist-sans)', 'system-ui', 'sans-serif'],
        mono: ['var(--font-geist-mono)', 'ui-monospace', 'SFMono-Regular', 'monospace'],
        display: ['var(--font-fraunces)', 'Georgia', 'serif'],
      },
      fontSize: {
        '2xs': ['0.6875rem', { lineHeight: '1rem', letterSpacing: '0.02em' }],
      },
      borderRadius: {
        xs: '2px',
        sm: '4px',
        md: 'var(--radius)',
        lg: 'calc(var(--radius) + 2px)',
        xl: '12px',
      },
      boxShadow: {
        pop: '0 1px 2px oklch(var(--ink) / 0.06), 0 8px 24px oklch(var(--ink) / 0.08)',
        modal: '0 4px 12px oklch(var(--ink) / 0.10), 0 32px 64px oklch(var(--ink) / 0.14)',
        input: 'inset 0 1px 0 oklch(var(--ink) / 0.04)',
      },
      transitionTimingFunction: {
        'out-quart': 'cubic-bezier(0.165, 0.84, 0.44, 1)',
        'out-quint': 'cubic-bezier(0.23, 1, 0.32, 1)',
        'out-expo': 'cubic-bezier(0.16, 1, 0.3, 1)',
      },
      transitionDuration: {
        fast: '120ms',
        DEFAULT: '180ms',
        slow: '280ms',
      },
      keyframes: {
        'fade-in': {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
        'fade-in-up': {
          '0%': { opacity: '0', transform: 'translateY(4px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
      },
      animation: {
        'fade-in': 'fade-in 180ms cubic-bezier(0.165, 0.84, 0.44, 1) both',
        'fade-in-up': 'fade-in-up 220ms cubic-bezier(0.165, 0.84, 0.44, 1) both',
      },
    },
  },
  plugins: [animate],
};

export default config;
