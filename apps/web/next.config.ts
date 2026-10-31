import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import createMDX from '@next/mdx';
import type { NextConfig } from 'next';
import createNextIntlPlugin from 'next-intl/plugin';

// The monorepo keeps a single .env at the root (Next.js only reads apps/web/.env* by itself).
const rootEnv = resolve(import.meta.dirname, '../../.env');
if (existsSync(rootEnv)) process.loadEnvFile(rootEnv);

const withNextIntl = createNextIntlPlugin('./i18n/request.ts');
const withMDX = createMDX({});

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  pageExtensions: ['ts', 'tsx', 'mdx'],
  // Public values derived from the shared server configuration.
  env: {
    NEXT_PUBLIC_API_URL: process.env.API_URL ?? 'http://localhost:4000',
    NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY ?? '',
    NEXT_PUBLIC_MEDIA_URL: process.env.MEDIA_PUBLIC_URL ?? '',
    NEXT_PUBLIC_GOOGLE_ENABLED: process.env.GOOGLE_CLIENT_ID ? 'true' : '',
    NEXT_PUBLIC_TURNSTILE_SITE_KEY: process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY ?? '',
    NEXT_PUBLIC_ANALYTICS_SRC: process.env.NEXT_PUBLIC_ANALYTICS_SRC ?? '',
    NEXT_PUBLIC_ANALYTICS_DOMAIN: process.env.NEXT_PUBLIC_ANALYTICS_DOMAIN ?? '',
  },
};

export default withNextIntl(withMDX(nextConfig));
