import path from 'node:path';
import { fileURLToPath } from 'node:url';
import withPWAInit from '@ducanh2912/next-pwa';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const withPWA = withPWAInit({
  dest: 'public',
  // Service worker actif seulement en production
  disable: process.env.NODE_ENV === 'development',
  reloadOnOnline: true,
  // Page de fallback hors-ligne
  fallbacks: { document: '/offline' },
  workboxOptions: { disableDevLogs: true },
});

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Vercel webhook sanity check: bumped 2026-05-25 after pnpm-lock sync
  ...(process.env.VERCEL
    ? {}
    : { outputFileTracingRoot: path.join(__dirname, '../..') }),
  env: {
    NEXT_PUBLIC_API_BASE_URL: process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:3001',
  },
};

export default withPWA(nextConfig);
