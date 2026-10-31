import type { Metadata } from 'next';
import type { Locale } from 'next-intl';
import { setRequestLocale } from 'next-intl/server';

export const metadata: Metadata = {
  title: 'Come funzionano i feedback | Accordo',
  alternates: { canonical: '/come-funzionano-i-feedback' },
};

/** Information on reviews (SPEC §8.8, §14: duty to explain how reviews are collected). */
export default async function Page({ params }: PageProps<'/[locale]/come-funzionano-i-feedback'>) {
  setRequestLocale((await params).locale as Locale);
  const page = 'come-funzionano-i-feedback';
  const { default: Content } = await import(`@/content/info/${page}.mdx`);
  return (
    <article className="mx-auto max-w-3xl px-4 py-10">
      <Content />
    </article>
  );
}
