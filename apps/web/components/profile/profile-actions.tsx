'use client';
import { Button } from '@accordo/ui';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { Link, useRouter } from '@/i18n/navigation';
import { api } from '@/lib/api';
import { useSession } from '@/lib/session';

export function ProfileActions({
  userId,
  username,
  isFollowing,
  isBlocked,
  isSelf,
}: {
  userId: string;
  username: string;
  isFollowing: boolean;
  isBlocked: boolean;
  isSelf: boolean;
}) {
  const t = useTranslations('Profile');
  const { data: session } = useSession();
  const router = useRouter();
  const [following, setFollowing] = useState(isFollowing);
  const [blocked, setBlocked] = useState(isBlocked);
  const [busy, setBusy] = useState(false);
  if (isSelf) return null;
  if (!session) {
    return (
      <Link
        href={`/accedi?next=/utente/${username}`}
        className="text-sm text-primary underline underline-offset-4"
      >
        {t('signInToFollow')}
      </Link>
    );
  }

  async function toggle(kind: 'follow' | 'block', on: boolean) {
    setBusy(true);
    try {
      await (on
        ? api.put(`/api/v1/users/${userId}/${kind}`)
        : api.delete(`/api/v1/users/${userId}/${kind}`));
      if (kind === 'follow') setFollowing(on);
      else {
        setBlocked(on);
        if (on) setFollowing(false);
      }
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-wrap gap-2">
      {!blocked ? (
        <Button
          size="sm"
          variant={following ? 'outline' : 'default'}
          aria-pressed={following}
          disabled={busy}
          onClick={() => toggle('follow', !following)}
        >
          {following ? t('following') : t('follow')}
        </Button>
      ) : null}
      <Button
        size="sm"
        variant="ghost"
        disabled={busy}
        onClick={() => (blocked || window.confirm(t('blockConfirm'))) && toggle('block', !blocked)}
      >
        {blocked ? t('unblock') : t('block')}
      </Button>
    </div>
  );
}
