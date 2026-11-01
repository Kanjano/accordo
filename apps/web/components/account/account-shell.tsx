'use client';
import { Alert, cn } from '@accordo/ui';
import { useTranslations } from 'next-intl';
import { type ReactNode, useEffect } from 'react';
import { Link, usePathname, useRouter } from '@/i18n/navigation';
import { useSession } from '@/lib/auth-client';

const NAV = [
  ['/account', 'overview'],
  ['/account/annunci', 'listings'],
  ['/account/acquisti', 'purchases'],
  ['/account/vendite', 'sales'],
  ['/account/incassi', 'payouts'],
  ['/account/feedback', 'feedback'],
  ['/account/negozio', 'shop'],
  ['/account/preferiti', 'favorites'],
  ['/account/ricerche-salvate', 'savedSearches'],
  ['/account/visti-di-recente', 'recentlyViewed'],
  ['/account/seguiti', 'following'],
  ['/account/notifiche', 'notifications'],
  ['/account/impostazioni/profilo', 'profile'],
  ['/account/impostazioni/indirizzi', 'addresses'],
  ['/account/impostazioni/sicurezza', 'security'],
  ['/account/impostazioni/notifiche', 'notifications'],
  ['/account/impostazioni/privacy', 'privacy'],
] as const;

/**
 * Client-side guard: the proxy redirects without a session cookie, this handles expired sessions.
 * `bare` renders only the guard (pages with their own layout, e.g. /vendi).
 */
export function AccountShell({ children, bare = false }: { children: ReactNode; bare?: boolean }) {
  const t = useTranslations('Account');
  const { data, isPending } = useSession();
  const pathname = usePathname();
  const router = useRouter();

  useEffect(() => {
    if (!isPending && !data) router.replace(`/accedi?next=${encodeURIComponent(pathname)}`);
  }, [isPending, data, pathname, router]);

  if (!data)
    return <p className="mx-auto max-w-6xl px-4 py-10 text-muted-foreground">{t('title')}…</p>;
  if (bare) return children;

  return (
    <div className="mx-auto grid max-w-6xl gap-8 px-4 py-8 md:grid-cols-[14rem_1fr]">
      <nav aria-label={t('nav.label')}>
        <ul className="flex gap-1 overflow-x-auto md:flex-col">
          {NAV.map(([href, key]) => (
            <li key={href}>
              <Link
                href={href}
                aria-current={
                  pathname === href || (href !== '/account' && pathname.startsWith(`${href}/`))
                    ? 'page'
                    : undefined
                }
                className={cn(
                  'block whitespace-nowrap rounded-md px-3 py-2 text-sm hover:bg-accent',
                  pathname === href ||
                    (href !== '/account' &&
                      pathname.startsWith(`${href}/`) &&
                      'bg-accent font-medium'),
                )}
              >
                {t(`nav.${key}`)}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
      <div className="grid content-start gap-6">
        {!data.user.emailVerified ? <Alert tone="error">{t('emailUnverified')}</Alert> : null}
        {children}
      </div>
    </div>
  );
}
