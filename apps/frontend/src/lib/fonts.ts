import { Fraunces, Geist, Geist_Mono } from 'next/font/google';

/**
 * Editorial typography pair for the ERP Compta UI.
 *
 *   - Geist Sans : UI body, labels, controls. Tabular figures by default.
 *   - Geist Mono : amounts (FCFA/EUR/USD), account codes, identifiers.
 *   - Fraunces   : reserved for page-level H1/H2 — the "cabinet" feel.
 *
 * All three are loaded as CSS variables and wired into Tailwind via
 * `tailwind.config.ts`. Subset to `latin` (FR-CI never needs more).
 */
export const geistSans = Geist({
  subsets: ['latin'],
  variable: '--font-geist-sans',
  display: 'swap',
});

export const geistMono = Geist_Mono({
  subsets: ['latin'],
  variable: '--font-geist-mono',
  display: 'swap',
});

export const fraunces = Fraunces({
  subsets: ['latin'],
  variable: '--font-fraunces',
  display: 'swap',
  axes: ['SOFT', 'WONK', 'opsz'],
});
