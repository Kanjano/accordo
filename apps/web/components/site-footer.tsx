import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';

export function SiteFooter() {
  const t = useTranslations('Footer');
  return (
    <footer className="border-t">
      <div className="mx-auto flex max-w-6xl flex-col gap-4 px-4 py-8 text-sm text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
        <p>{t('rights', { year: new Date().getFullYear() })}</p>
        <ul className="flex gap-4">
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
        </ul>
      </div>
    </footer>
  );
}
