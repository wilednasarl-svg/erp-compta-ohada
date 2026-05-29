import { fileURLToPath } from 'node:url';

import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

/**
 * Config Vitest du frontend ERP Compta. Fichier `.mts` (chargé en ESM) car
 * Vite 7 est ESM-only. Environnement jsdom (les stores zustand persistent
 * dans `localStorage` ; les composants montent du DOM). Alias `@/` aligné sur
 * `tsconfig.json` (`@/*` → `./src/*`).
 */
export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'happy-dom',
    setupFiles: ['./vitest.setup.ts'],
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
    css: false,
    clearMocks: true,
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
});
