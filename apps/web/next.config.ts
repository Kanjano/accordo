import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import createMDX from '@next/mdx';
import type { NextConfig } from 'next';
import createNextIntlPlugin from 'next-intl/plugin';

// The monorepo keeps a single .env at the root (Next.js only reads apps/web/.env* by itself).
const rootEnv = resolve(import.meta.dirname, '../../.env');
if (existsSync(rootEnv)) process.loadEnvFile(rootEnv);

// Messages are precompiled at build time: the ICU parser stays out of the client bundle (SPEC §12.4).
const withNextIntl = createNextIntlPlugin({
  requestConfig: './i18n/request.ts',
  experimental: {
    messages: { path: './messages', format: 'json', locales: 'infer', precompile: true },
  },
});
const withMDX = createMDX({});

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  pageExtensions: ['ts', 'tsx', 'mdx'],
  // Self-contained server for the Docker image (SPEC §15.4).
  output: 'standalone',
  outputFileTracingRoot: resolve(import.meta.dirname, '../..'),
  // Security headers for every response; the CSP with nonce is set per page in proxy.ts (SPEC §13.6).
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'X-Frame-Options', value: 'DENY' },
          {
            key: 'Permissions-Policy',
            value:
              'camera=(), microphone=(), geolocation=(), browsing-topics=(), payment=(self "https://js.stripe.com")',
          },
          ...(process.env.NODE_ENV === 'production'
            ? [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains' }]
            : []),
        ],
      },
    ];
  },
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
