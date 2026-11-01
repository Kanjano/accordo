import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import { CookieSettingsButton } from './consent/cookie-banner';

export function SiteFooter() {
  const t = useTranslations('Footer');
  return (
    <footer className="border-t">
      <div className="mx-auto flex max-w-6xl flex-col gap-4 px-4 py-8 text-sm text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
        <p>{t('rights', { year: new Date().getFullYear() })}</p>
        <ul className="flex flex-wrap gap-x-4 gap-y-2">
          <li>
            <Link href="/note-legali" className="hover:text-foreground">
              {t('legal')}
            </Link>
          </li>
          <li>
            <Link href="/privacy" className="hover:text-foreground">
              {t('privacy')}
            </Link>
          </li>
          <li>
            <Link href="/termini" className="hover:text-foreground">
              {t('terms')}
            </Link>
          </li>
          <li>
            <Link href="/condizioni-pagamento-protetto" className="hover:text-foreground">
              {t('termsProtected')}
            </Link>
          </li>
          <li>
            <Link href="/regole-pubblicazione" className="hover:text-foreground">
              {t('rules')}
            </Link>
          </li>
          <li>
            <Link href="/negozi" className="hover:text-foreground">
              {t('shops')}
            </Link>
          </li>
          <li>
            <Link href="/parametri-di-classificazione" className="hover:text-foreground">
              {t('ranking')}
            </Link>
          </li>
          <li>
            <Link href="/cookie" className="hover:text-foreground">
              {t('cookies')}
            </Link>
          </li>
          <li>
            <Link href="/accessibilita" className="hover:text-foreground">
              {t('accessibility')}
            </Link>
          </li>
          <li>
            <CookieSettingsButton label={t('cookieSettings')} className="hover:text-foreground" />
          </li>
        </ul>
      </div>
    </footer>
  );
}
