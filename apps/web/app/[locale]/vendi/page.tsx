import type { Metadata } from 'next';
import type { Locale } from 'next-intl';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { AccountShell } from '@/components/account/account-shell';
import { SellWizard } from '@/components/sell/sell-wizard';

export async function generateMetadata({
  params,
}: PageProps<'/[locale]/vendi'>): Promise<Metadata> {
  const t = await getTranslations({ locale: (await params).locale as Locale, namespace: 'Sell' });
  return { title: `${t('title')} — Accordo`, robots: { index: false } };
}

export default async function SellPage({ params }: PageProps<'/[locale]/vendi'>) {
  setRequestLocale((await params).locale as Locale);
  const t = await getTranslations('Sell');
  return (
    <AccountShell bare>
      <div className="mx-auto grid w-full max-w-3xl gap-6 px-4 py-8">
        <h1 className="text-3xl font-bold">{t('title')}</h1>
        <SellWizard />
      </div>
    </AccountShell>
  );
}
