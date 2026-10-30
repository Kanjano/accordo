import type { Metadata } from 'next';
import type { Locale } from 'next-intl';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Suspense } from 'react';
import { AuthCard } from '@/components/auth/auth-card';
import { SignUpForm } from '@/components/auth/sign-up-form';

export async function generateMetadata({
  params,
}: PageProps<'/[locale]/registrati'>): Promise<Metadata> {
  const t = await getTranslations({
    locale: (await params).locale as Locale,
    namespace: 'Auth.signUp',
  });
  return { title: t('title'), robots: { index: false } };
}

export default async function Page({ params }: PageProps<'/[locale]/registrati'>) {
  setRequestLocale((await params).locale as Locale);
  const t = await getTranslations('Auth.signUp');
  return (
    <AuthCard title={t('title')} description={t('subtitle')}>
      <Suspense>
        <SignUpForm />
      </Suspense>
    </AuthCard>
  );
}
