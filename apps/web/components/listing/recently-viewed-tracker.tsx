'use client';
import type { ListingCardItem } from '@accordo/shared';
import { useEffect } from 'react';
import { api } from '@/lib/api';
import { useSession } from '@/lib/auth-client';
import { pushRecent } from '@/lib/recently-viewed';

/** Records the view locally and, when signed in, on the account. */
export function RecentlyViewedTracker({ item }: { item: ListingCardItem }) {
  const { data: session, isPending } = useSession();
  useEffect(() => {
    if (isPending) return;
    pushRecent(item);
    if (session)
      void api.post('/api/v1/me/recently-viewed', { listingIds: [item.id] }).catch(() => undefined);
  }, [item, session, isPending]);
  return null;
}
