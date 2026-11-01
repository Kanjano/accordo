import type { Metadata } from 'next';
import type { Locale } from 'next-intl';
import { getTranslations, setRequestLocale } from 'next-intl/server';

export async function generateMetadata({
  params,
}: PageProps<'/[locale]/offline'>): Promise<Metadata> {
  const t = await getTranslations({
    locale: (await params).locale as Locale,
    namespace: 'Offline',
  });
  return { title: t('title'), robots: { index: false } };
}

/** Cached by the service worker and shown when a page cannot be reached. */
export default async function Page({ params }: PageProps<'/[locale]/offline'>) {
  setRequestLocale((await params).locale as Locale);
  const t = await getTranslations('Offline');
  return (
    <div className="mx-auto grid max-w-md gap-3 px-4 py-16 text-center">
      <h1 className="text-2xl font-bold">{t('title')}</h1>
      <p className="text-muted-foreground">{t('text')}</p>
    </div>
  );
}
