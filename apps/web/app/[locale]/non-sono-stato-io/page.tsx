import type { Metadata } from 'next';
import type { Locale } from 'next-intl';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Suspense } from 'react';
import { AuthCard } from '@/components/auth/auth-card';
import { NotMeForm } from '@/components/auth/password-forms';

export async function generateMetadata({
  params,
}: PageProps<'/[locale]/non-sono-stato-io'>): Promise<Metadata> {
  const t = await getTranslations({
    locale: (await params).locale as Locale,
    namespace: 'Auth.notMe',
  });
  return { title: t('title'), robots: { index: false } };
}

export default async function Page({ params }: PageProps<'/[locale]/non-sono-stato-io'>) {
  setRequestLocale((await params).locale as Locale);
  const t = await getTranslations('Auth.notMe');
  return (
    <AuthCard title={t('title')}>
      <Suspense>
        <NotMeForm />
      </Suspense>
    </AuthCard>
  );
}
