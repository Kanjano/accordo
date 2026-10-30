'use client';
import { buttonVariants } from '@accordo/ui';
import { UserRound } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Link, useRouter } from '@/i18n/navigation';
import { signOut, useSession } from '@/lib/auth-client';

export function UserMenu() {
  const t = useTranslations('Header');
  const { data, isPending } = useSession();
  const router = useRouter();
  if (isPending)
    return <span className="inline-block h-9 w-20 animate-pulse rounded-md bg-muted" aria-hidden />;
  if (!data) {
    return (
      <Link href="/accedi" className={buttonVariants({ size: 'sm' })}>
        {t('signIn')}
      </Link>
    );
  }
  return (
    <span className="flex items-center gap-1">
      <Link href="/account" className={buttonVariants({ variant: 'ghost', size: 'sm' })}>
        <UserRound aria-hidden />
        <span className="max-sm:sr-only">{t('account')}</span>
      </Link>
      <button
        type="button"
        className={buttonVariants({ variant: 'outline', size: 'sm' })}
        onClick={async () => {
          await signOut();
          router.push('/');
          router.refresh();
        }}
      >
        {t('signOut')}
      </button>
    </span>
  );
}
