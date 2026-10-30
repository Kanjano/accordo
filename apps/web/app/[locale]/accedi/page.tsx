import type { Metadata } from 'next';
import type { Locale } from 'next-intl';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Suspense } from 'react';
import { AuthCard } from '@/components/auth/auth-card';
import { SignInForm } from '@/components/auth/sign-in-form';

export async function generateMetadata({
  params,
}: PageProps<'/[locale]/accedi'>): Promise<Metadata> {
  const t = await getTranslations({
    locale: (await params).locale as Locale,
    namespace: 'Auth.signIn',
  });
  return { title: t('title'), robots: { index: false } };
}

export default async function Page({ params }: PageProps<'/[locale]/accedi'>) {
  setRequestLocale((await params).locale as Locale);
  const t = await getTranslations('Auth.signIn');
  return (
    <AuthCard title={t('title')} description={t('subtitle')}>
      <Suspense>
        <SignInForm />
      </Suspense>
    </AuthCard>
  );
}
