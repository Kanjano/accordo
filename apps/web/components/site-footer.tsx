import { useTranslations } from 'next-intl';
import type { ReactNode } from 'react';
import { Link } from '@/i18n/navigation';
import { CookieSettingsButton } from './consent/cookie-banner';

export function SiteFooter() {
  const t = useTranslations('Footer');
  const market = [
    ['/annunci', t('listings')],
    ['/vendi', t('sell')],
    ['/negozi', t('shops')],
    ['/come-funzionano-i-feedback', t('feedback')],
    ['/segnala', t('report')],
  ] as const;
  const info = [
    ['/termini', t('terms')],
    ['/condizioni-pagamento-protetto', t('termsProtected')],
    ['/regole-pubblicazione', t('rules')],
    ['/parametri-di-classificazione', t('ranking')],
    ['/privacy', t('privacy')],
    ['/cookie', t('cookies')],
    ['/note-legali', t('legal')],
    ['/accessibilita', t('accessibility')],
  ] as const;
  return (
    <footer className="mt-8 border-t bg-muted text-sm">
      <div className="mx-auto grid max-w-7xl gap-8 px-4 py-10 sm:grid-cols-2 lg:grid-cols-[2fr_1fr_1fr]">
        <div className="grid content-start gap-2">
          <p className="text-lg font-extrabold text-primary">Accordo</p>
          <p className="max-w-sm text-muted-foreground">{t('tagline')}</p>
        </div>
        <FooterColumn title={t('market')} links={market} />
        <FooterColumn title={t('info')} links={info}>
          <li>
            <CookieSettingsButton
              label={t('cookieSettings')}
              className="text-muted-foreground hover:text-foreground hover:underline"
            />
          </li>
        </FooterColumn>
      </div>
      <p className="border-t py-4 text-center text-xs text-muted-foreground">
        {t('rights', { year: new Date().getFullYear() })}
      </p>
    </footer>
  );
}

function FooterColumn({
  title,
  links,
  children,
}: {
  title: string;
  links: ReadonlyArray<readonly [string, string]>;
  children?: ReactNode;
}) {
  return (
    <nav aria-label={title}>
      <h2 className="mb-2 text-xs font-bold tracking-wide uppercase">{title}</h2>
      <ul className="grid gap-1.5">
        {links.map(([href, label]) => (
          <li key={href}>
            <Link
              href={href}
              className="text-muted-foreground hover:text-foreground hover:underline"
            >
              {label}
            </Link>
          </li>
        ))}
        {children}
      </ul>
    </nav>
  );
}
