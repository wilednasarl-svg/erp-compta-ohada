import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Vercel webhook sanity check: bumped 2026-05-25 after pnpm-lock sync
// (commit 1a5b838) to confirm GitHub-triggered builds succeed end-to-end.
/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Locally: pin tracing root to the workspace root to silence the
  // "multiple lockfiles detected" warning. On Vercel, leave it unset —
  // setting it there causes a double-path bug in the output collector
  // (/vercel/path0/vercel/path0/.next/...).
  ...(process.env.VERCEL
    ? {}
    : { outputFileTracingRoot: path.join(__dirname, '../..') }),
  // The backend lives at NEXT_PUBLIC_API_BASE_URL. Defaults to the dev
  // server. Set this to the prod URL (e.g. https://api.erp-compta.io) in
  // Vercel env vars at deploy time.
  env: {
    NEXT_PUBLIC_API_BASE_URL: process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:3001',
  },
};

export default nextConfig;
