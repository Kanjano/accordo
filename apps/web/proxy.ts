import { NextRequest, NextResponse } from 'next/server';
import createMiddleware from 'next-intl/middleware';
import { routing } from './i18n/routing';

const intl = createMiddleware(routing);
const SESSION_COOKIES = ['better-auth.session_token', '__Secure-better-auth.session_token'];

const origin = (url: string | undefined) => (url ? new URL(url).origin : '');
const API = origin(process.env.NEXT_PUBLIC_API_URL);
const MEDIA = origin(process.env.NEXT_PUBLIC_MEDIA_URL);
const ANALYTICS = origin(process.env.NEXT_PUBLIC_ANALYTICS_SRC);
const isDev = process.env.NODE_ENV === 'development';

/**
 * Strict CSP with a per-request nonce (SPEC §13.6, ADR-0050). 'strict-dynamic' lets the nonced
 * Next.js scripts load Stripe.js, Turnstile and the analytics script; the host lists are the
 * fallback for browsers without CSP3. Styles allow 'unsafe-inline' (style attributes and the
 * widgets' injected styles cannot carry a nonce).
 */
export function contentSecurityPolicy(nonce: string): string {
  const ws = API.replace(/^http/, 'ws');
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic' https://js.stripe.com https://challenges.cloudflare.com ${ANALYTICS}${isDev ? " 'unsafe-eval'" : ''}`,
    "style-src 'self' 'unsafe-inline'",
    `img-src 'self' blob: data: ${MEDIA} https://*.stripe.com`,
    "font-src 'self'",
    `connect-src 'self' ${API} ${ws} ${MEDIA} https://api.stripe.com https://challenges.cloudflare.com ${ANALYTICS}`,
    'frame-src https://js.stripe.com https://hooks.stripe.com https://challenges.cloudflare.com',
    "worker-src 'self'",
    "manifest-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    ...(process.env.WEB_URL?.startsWith('https:') ? ['upgrade-insecure-requests'] : []),
  ]
    .join('; ')
    .replace(/ {2,}/g, ' ');
}

/**
 * i18n routing, an optimistic auth check (without a session cookie the private area redirects to
 * /accedi; the API remains the authority) and the CSP nonce, read by Next.js from the request header.
 */
export default function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  const isPrivate = /^\/(en\/)?(account|vendi|messaggi|checkout|admin)(\/|$)/.test(pathname);
  if (isPrivate && !SESSION_COOKIES.some((c) => request.cookies.has(c))) {
    const url = request.nextUrl.clone();
    url.pathname = pathname.startsWith('/en/') ? '/en/accedi' : '/accedi';
    url.search = `?next=${encodeURIComponent(pathname.replace(/^\/en/, '') + search)}`;
    return NextResponse.redirect(url);
  }
  const nonce = Buffer.from(crypto.randomUUID()).toString('base64');
  const csp = contentSecurityPolicy(nonce);
  const headers = new Headers(request.headers);
  headers.set('x-nonce', nonce);
  headers.set('content-security-policy', csp);
  // next-intl forwards the request headers it receives, so Next.js sees the nonce.
  const response = intl(new NextRequest(request, { headers }));
  response.headers.set('content-security-policy', csp);
  return response;
}

export const config = {
  matcher: '/((?!api|_next|_vercel|.*\\..*).*)',
};
