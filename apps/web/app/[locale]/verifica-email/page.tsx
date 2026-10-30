import { Alert, buttonVariants } from '@accordo/ui';
import type { Metadata } from 'next';
import type { Locale } from 'next-intl';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { AuthCard } from '@/components/auth/auth-card';
import { Link } from '@/i18n/navigation';

export async function generateMetadata({
  params,
}: PageProps<'/[locale]/verifica-email'>): Promise<Metadata> {
  const t = await getTranslations({
    locale: (await params).locale as Locale,
    namespace: 'Auth.verifyEmail',
  });
  return { title: t('title'), robots: { index: false } };
}

/** Landing page of the verification link (Better Auth redirects here with ?stato=ok or ?error=…). */
export default async function Page({
  params,
  searchParams,
}: PageProps<'/[locale]/verifica-email'>) {
  setRequestLocale((await params).locale as Locale);
  const t = await getTranslations('Auth.verifyEmail');
  const sp = await searchParams;
  const state = sp.error ? 'error' : sp.stato === 'ok' ? 'ok' : 'pending';
  return (
    <AuthCard title={t('title')}>
      <div className="grid gap-4">
        <Alert tone={state === 'ok' ? 'success' : state === 'error' ? 'error' : 'info'}>
          {t(state)}
        </Alert>
        {state === 'ok' ? (
          <Link href="/account" className={buttonVariants()}>
            {t('goToAccount')}
          </Link>
        ) : (
          <Link href="/accedi" className={buttonVariants({ variant: 'outline' })}>
            {t('signIn')}
          </Link>
        )}
      </div>
    </AuthCard>
  );
}
