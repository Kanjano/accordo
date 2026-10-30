import createMiddleware from 'next-intl/middleware';
import { routing } from './i18n/routing';

// Security headers and CSP with nonce are added here in Phase 12 (SPEC §13.6).
export default createMiddleware(routing);

export const config = {
  matcher: '/((?!api|_next|_vercel|.*\\..*).*)',
};
