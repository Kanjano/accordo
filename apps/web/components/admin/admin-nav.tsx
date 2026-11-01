'use client';
import { cn } from '@accordo/ui';
import { useTranslations } from 'next-intl';
import { Link, usePathname } from '@/i18n/navigation';
import { useSession } from '@/lib/session';

const NAV = [
  ['/admin', 'dashboard'],
  ['/admin/segnalazioni', 'reports'],
  ['/admin/annunci', 'listings'],
  ['/admin/ricorsi', 'appeals'],
  ['/admin/utenti', 'users'],
  ['/admin/ordini', 'orders'],
  ['/admin/controversie', 'disputes'],
  ['/admin/feedback', 'feedback'],
  ['/admin/negozi', 'shops'],
  ['/admin/dac7', 'dac7'],
  ['/admin/catalogo', 'catalog'],
  ['/admin/impostazioni', 'settings'],
  ['/admin/audit', 'audit'],
  ['/admin/webhook', 'webhooks'],
] as const;

/** Back-office sections (SPEC §3.10); the API enforces roles and 2FA on each of them. */
export function AdminNav() {
  const t = useTranslations('Admin');
  const pathname = usePathname();
  const { data } = useSession();
  const staffWithout2fa = data && !data.user.twoFactorEnabled;
  return (
    <div className="grid gap-3">
      <nav aria-label={t('nav')} className="overflow-x-auto">
        <ul className="flex gap-1 text-sm">
          {NAV.map(([href, key]) => (
            <li key={href}>
              <Link
                href={href}
                aria-current={pathname === href ? 'page' : undefined}
                className={cn(
                  'block whitespace-nowrap rounded-md px-3 py-1.5 hover:bg-accent',
                  pathname === href && 'bg-accent font-medium',
                )}
              >
                {t(`sections.${key}`)}
              </Link>
            </li>
          ))}
          <li>
            <a
              href={`${process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000'}/admin/queues`}
              className="block whitespace-nowrap rounded-md px-3 py-1.5 hover:bg-accent"
            >
              {t('sections.queues')}
            </a>
          </li>
        </ul>
      </nav>
      {staffWithout2fa ? (
        <p className="rounded-md bg-muted p-3 text-sm">
          {t('needs2fa')}{' '}
          <Link href="/account/impostazioni/sicurezza" className="underline">
            {t('enable2fa')}
          </Link>
        </p>
      ) : null}
    </div>
  );
}
