import type { Metadata } from 'next';
import type { Locale } from 'next-intl';
import { setRequestLocale } from 'next-intl/server';

export const metadata: Metadata = {
  title: 'Parametri di classificazione | Accordo',
  alternates: { canonical: '/parametri-di-classificazione' },
};

/** Main ranking parameters of the search results (SPEC §14.3, Omnibus). */
export default async function Page({
  params,
}: PageProps<'/[locale]/parametri-di-classificazione'>) {
  setRequestLocale((await params).locale as Locale);
  const page = 'parametri-di-classificazione';
  const { default: Content } = await import(`@/content/info/${page}.mdx`);
  return (
    <article className="mx-auto max-w-3xl px-4 py-10">
      <Content />
    </article>
  );
}
