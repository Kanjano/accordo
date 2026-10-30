import { type NextRequest, NextResponse } from 'next/server';
import createMiddleware from 'next-intl/middleware';
import { routing } from './i18n/routing';

const intl = createMiddleware(routing);
const SESSION_COOKIES = ['better-auth.session_token', '__Secure-better-auth.session_token'];

/**
 * i18n routing plus an optimistic auth check: without a session cookie the private area redirects
 * to /accedi. The API remains the authority (the account shell re-checks the session).
 * Security headers and CSP with nonce arrive in Phase 12 (SPEC §13.6).
 */
export default function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  const isPrivate = /^\/(en\/)?account(\/|$)/.test(pathname);
  if (isPrivate && !SESSION_COOKIES.some((c) => request.cookies.has(c))) {
    const url = request.nextUrl.clone();
    url.pathname = pathname.startsWith('/en/') ? '/en/accedi' : '/accedi';
    url.search = `?next=${encodeURIComponent(pathname.replace(/^\/en/, '') + search)}`;
    return NextResponse.redirect(url);
  }
  return intl(request);
}

export const config = {
  matcher: '/((?!api|_next|_vercel|.*\\..*).*)',
};
