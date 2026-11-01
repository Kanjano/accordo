import { buttonVariants } from '@accordo/ui';
import { Music2, Plus } from 'lucide-react';
import { getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { ImpersonationBanner } from './impersonation-banner';
import { SearchBox } from './search/search-box';
import { loadCatalog } from './search/search-results-page';
import { UserMenu } from './user-menu';

export async function SiteHeader() {
  const t = await getTranslations('Header');
  // The category bar is navigation, not content: an API outage must not break every page.
  const departments = await loadCatalog()
    .then((c) => c.departments)
    .catch(() => []);
  return (
    <header className="border-b bg-background">
      <ImpersonationBanner />
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-background focus:px-3 focus:py-2 focus:ring-2 focus:ring-ring"
      >
        {t('skipToContent')}
      </a>
      <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-6 gap-y-3 px-4 py-3">
        <Link
          href="/"
          aria-label={t('home')}
          className="flex items-center gap-2 text-2xl font-extrabold tracking-tight text-primary"
        >
          <span className="grid size-8 place-items-center rounded-lg bg-primary text-primary-foreground">
            <Music2 aria-hidden className="size-5" />
          </span>
          Accordo
        </Link>
        <SearchBox className="order-last w-full md:order-none md:flex-1" size="lg" />
        <nav aria-label={t('nav')} className="ml-auto md:ml-0">
          <ul className="flex items-center gap-1 text-sm font-medium sm:gap-2">
            <li className="max-sm:hidden">
              <Link href="/negozi" className="rounded-md px-3 py-2 hover:bg-accent">
                {t('shops')}
              </Link>
            </li>
            <li>
              <UserMenu />
            </li>
            <li>
              <Link href="/vendi" className={buttonVariants({ className: 'font-semibold' })}>
                <Plus aria-hidden />
                {t('sell')}
              </Link>
            </li>
          </ul>
        </nav>
      </div>
      <nav aria-label={t('categories')} className="bg-primary text-primary-foreground">
        <ul className="mx-auto flex max-w-7xl gap-1 overflow-x-auto px-2 text-sm font-medium whitespace-nowrap [scrollbar-width:none]">
          <li>
            <Link href="/annunci" className="block px-3 py-2.5 hover:bg-black/15">
              {t('listings')}
            </Link>
          </li>
          {departments.map((d) => (
            <li key={d.id}>
              <Link href={`/categoria/${d.slug}`} className="block px-3 py-2.5 hover:bg-black/15">
                {d.name}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
    </header>
  );
}
