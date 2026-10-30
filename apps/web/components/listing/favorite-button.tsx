'use client';
import { Button, cn } from '@accordo/ui';
import { Heart } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { usePathname, useRouter } from '@/i18n/navigation';
import { useFavorites } from '@/lib/favorites';

export function FavoriteButton({
  listingId,
  title,
  className,
}: {
  listingId: string;
  title: string;
  className?: string;
}) {
  const t = useTranslations('Favorites');
  const { signedIn, isFavorite, toggle } = useFavorites();
  const router = useRouter();
  const pathname = usePathname();
  const on = isFavorite(listingId);
  return (
    <Button
      type="button"
      size="icon"
      variant="outline"
      aria-pressed={on}
      aria-label={on ? t('remove', { title }) : t('add', { title })}
      className={cn('rounded-full bg-background/90', className)}
      onClick={() =>
        signedIn ? toggle(listingId) : router.push(`/accedi?next=${encodeURIComponent(pathname)}`)
      }
    >
      <Heart aria-hidden className={cn(on && 'fill-red-600 text-red-600')} />
    </Button>
  );
}
