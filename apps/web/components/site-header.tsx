import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import { ImpersonationBanner } from './impersonation-banner';
import { SearchBox } from './search/search-box';
import { UserMenu } from './user-menu';

export function SiteHeader() {
  const t = useTranslations('Header');
  return (
    <header className="border-b">
      <ImpersonationBanner />
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:rounded-md focus:bg-background focus:px-3 focus:py-2 focus:ring-2 focus:ring-ring"
      >
        {t('skipToContent')}
      </a>
      <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-3">
        <Link
          href="/"
          aria-label={t('home')}
          className="text-xl font-bold tracking-tight text-primary"
        >
          Accordo
        </Link>
        <SearchBox className="order-last w-full md:order-none md:w-auto md:max-w-md md:flex-1" />
        <nav aria-label={t('nav')}>
          <ul className="flex items-center gap-1 text-sm font-medium sm:gap-4">
            <li>
              <Link href="/annunci" className="rounded-md px-3 py-2 hover:bg-accent">
                {t('listings')}
              </Link>
            </li>
            <li className="max-sm:hidden">
              <Link href="/negozi" className="rounded-md px-3 py-2 hover:bg-accent">
                {t('shops')}
              </Link>
            </li>
            <li>
              <Link href="/vendi" className="rounded-md px-3 py-2 hover:bg-accent">
                {t('sell')}
              </Link>
            </li>
            <li>
              <UserMenu />
            </li>
          </ul>
        </nav>
      </div>
    </header>
  );
}
