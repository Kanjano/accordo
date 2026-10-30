import type { Metadata } from 'next';
import type { Locale } from 'next-intl';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Suspense } from 'react';
import { AuthCard } from '@/components/auth/auth-card';
import { ForgotPasswordForm } from '@/components/auth/password-forms';

export async function generateMetadata({
  params,
}: PageProps<'/[locale]/password-dimenticata'>): Promise<Metadata> {
  const t = await getTranslations({
    locale: (await params).locale as Locale,
    namespace: 'Auth.forgot',
  });
  return { title: t('title'), robots: { index: false } };
}

export default async function Page({ params }: PageProps<'/[locale]/password-dimenticata'>) {
  setRequestLocale((await params).locale as Locale);
  const t = await getTranslations('Auth.forgot');
  return (
    <AuthCard title={t('title')}>
      <Suspense>
        <ForgotPasswordForm />
      </Suspense>
    </AuthCard>
  );
}
