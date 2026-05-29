import { defineConfig, devices } from '@playwright/test';

/**
 * E2E navigateur du Report Console (scénarios 6.1→6.3 de
 * `src/app/reports/_console/ACCEPTANCE.md`).
 *
 * Pré-requis (cf. e2e/README.md) : un backend joignable sur
 * NEXT_PUBLIC_API_BASE_URL et une base Postgres JETABLE accessible via
 * E2E_DATABASE_URL (jamais la prod — global-setup y insère des écritures).
 * Le frontend est démarré automatiquement par `webServer`.
 */
const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:3000';
const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:3001';
const PORT = new URL(BASE_URL).port || '3000';

export default defineConfig({
  testDir: './e2e',
  outputDir: './e2e/.artifacts',
  timeout: 45_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: [['list']],
  globalSetup: './e2e/global-setup.ts',
  use: {
    baseURL: BASE_URL,
    storageState: './e2e/.auth/state.json',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: `pnpm exec next dev -p ${PORT}`,
    url: BASE_URL,
    reuseExistingServer: true,
    timeout: 120_000,
    env: { NEXT_PUBLIC_API_BASE_URL: API_BASE_URL },
  },
});
