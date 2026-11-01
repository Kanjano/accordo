'use client';
import { Alert, buttonVariants, Card, CardContent, CardHeader } from '@accordo/ui';
import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import { useSession } from '@/lib/session';

export default function AccountOverview() {
  const t = useTranslations('Account');
  const { data } = useSession();
  if (!data) return null;
  const user = data.user as typeof data.user & {
    username?: string | null;
    twoFactorEnabled?: boolean | null;
  };
  return (
    <Card>
      <CardHeader>
        <h1 className="text-2xl font-bold">{t('welcome', { name: user.name })}</h1>
      </CardHeader>
      <CardContent className="grid gap-4">
        <p className="text-muted-foreground">{t('overviewText')}</p>
        {!user.twoFactorEnabled ? (
          <Alert>
            <Link href="/account/impostazioni/sicurezza" className="underline underline-offset-4">
              {t('twoFactorHint')}
            </Link>
          </Alert>
        ) : null}
        {user.username ? (
          <Link
            href={`/utente/${user.username}`}
            className={buttonVariants({ variant: 'outline', className: 'justify-self-start' })}
          >
            {t('publicProfile')}
          </Link>
        ) : null}
      </CardContent>
    </Card>
  );
}
