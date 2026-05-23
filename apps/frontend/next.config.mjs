import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Monorepo: pin tracing root to the workspace root so Next stops
  // emitting the "multiple lockfiles detected" warning and so the
  // output trace covers the right packages.
  outputFileTracingRoot: path.join(__dirname, '../..'),
  // The backend lives at NEXT_PUBLIC_API_BASE_URL. Defaults to the dev
  // server. Set this to the prod URL (e.g. https://api.erp-compta.io) in
  // Vercel env vars at deploy time.
  env: {
    NEXT_PUBLIC_API_BASE_URL: process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:3001',
  },
};

export default nextConfig;
