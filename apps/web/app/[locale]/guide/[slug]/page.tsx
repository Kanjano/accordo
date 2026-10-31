import type { Metadata } from 'next';
import type { Locale } from 'next-intl';
import { setRequestLocale } from 'next-intl/server';

/** Guides (SPEC §12.1 `/guide/[slug]`), versioned MDX in content/guides. */
const GUIDES = { imballaggio: 'Come imballare uno strumento' } as const;
type Slug = keyof typeof GUIDES;

export const dynamicParams = false;

export function generateStaticParams() {
  return Object.keys(GUIDES).map((slug) => ({ slug }));
}

export async function generateMetadata({
  params,
}: PageProps<'/[locale]/guide/[slug]'>): Promise<Metadata> {
  return {
    title: `${GUIDES[(await params).slug as Slug]} | Accordo`,
    alternates: { canonical: `/guide/${(await params).slug}` },
  };
}

export default async function GuidePage({ params }: PageProps<'/[locale]/guide/[slug]'>) {
  const { locale, slug } = await params;
  setRequestLocale(locale as Locale);
  const { default: Content } = await import(`@/content/guides/${slug}.mdx`);
  return (
    <article className="mx-auto max-w-3xl px-4 py-10">
      <Content />
    </article>
  );
}
