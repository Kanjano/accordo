'use client';
import { buttonVariants } from '@accordo/ui';
import { useQuery } from '@tanstack/react-query';
import { Bell, MessageCircle, UserRound } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Link, useRouter } from '@/i18n/navigation';
import { api } from '@/lib/api';
import { signOut, useSession } from '@/lib/auth-client';
import { useRealtimeConnected } from '@/lib/realtime';
import { useUnreadNotifications } from './account/notifications-list';

export function UserMenu() {
  const t = useTranslations('Header');
  const { data, isPending } = useSession();
  if (isPending)
    return <span className="inline-block h-9 w-20 animate-pulse rounded-md bg-muted" aria-hidden />;
  if (!data) {
    return (
      <Link href="/accedi" className={buttonVariants({ size: 'sm' })}>
        {t('signIn')}
      </Link>
    );
  }
  return <SignedInMenu />;
}

function SignedInMenu() {
  const t = useTranslations('Header');
  const router = useRouter();
  const unread = useUnreadNotifications();
  const connected = useRealtimeConnected();
  const { data: messages } = useQuery({
    queryKey: ['conversations-unread'],
    queryFn: () => api.get<{ count: number }>('/api/v1/conversations/unread-count'),
    refetchInterval: connected ? false : 30_000,
  });
  const unreadMessages = messages?.count ?? 0;
  return (
    <span className="flex items-center gap-1">
      <Link
        href="/messaggi"
        aria-label={t('messages', { count: unreadMessages })}
        className={buttonVariants({ variant: 'ghost', size: 'icon', className: 'relative' })}
      >
        <MessageCircle aria-hidden />
        {unreadMessages ? (
          <span
            aria-hidden
            className="absolute top-1 right-1 min-w-4 rounded-full bg-primary px-1 text-[10px] leading-4 text-primary-foreground"
          >
            {unreadMessages > 9 ? '9+' : unreadMessages}
          </span>
        ) : null}
      </Link>
      <Link
        href="/account/notifiche"
        aria-label={unread.label}
        className={buttonVariants({ variant: 'ghost', size: 'icon', className: 'relative' })}
      >
        <Bell aria-hidden />
        {unread.count ? (
          <span
            aria-hidden
            className="absolute top-1 right-1 min-w-4 rounded-full bg-primary px-1 text-[10px] leading-4 text-primary-foreground"
          >
            {unread.count > 9 ? '9+' : unread.count}
          </span>
        ) : null}
      </Link>
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
