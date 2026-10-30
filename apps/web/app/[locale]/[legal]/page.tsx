import type { Metadata } from 'next';
import type { Locale } from 'next-intl';
import { setRequestLocale } from 'next-intl/server';

const PAGES = {
  termini: 'Termini di servizio',
  privacy: 'Informativa privacy',
  cookie: 'Informativa cookie',
  'note-legali': 'Note legali',
  'condizioni-pagamento-protetto': 'Condizioni del pagamento protetto',
  'regole-pubblicazione': 'Regole di pubblicazione',
} as const;
type Slug = keyof typeof PAGES;

export const dynamicParams = false;

export function generateStaticParams() {
  return Object.keys(PAGES).map((legal) => ({ legal }));
}

export async function generateMetadata({
  params,
}: PageProps<'/[locale]/[legal]'>): Promise<Metadata> {
  return { title: `${PAGES[(await params).legal as Slug]} — Accordo` };
}

/** Legal pages are versioned MDX in content/legal (placeholders until legal review). */
export default async function LegalPage({ params }: PageProps<'/[locale]/[legal]'>) {
  const { locale, legal } = await params;
  setRequestLocale(locale as Locale);
  const { default: Content } = await import(`@/content/legal/${legal}.mdx`);
  return (
    <article className="mx-auto max-w-3xl px-4 py-10">
      <Content />
    </article>
  );
}
