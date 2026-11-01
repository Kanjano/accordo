'use client';
import { SEARCH_SORTS, type SearchQuery } from '@accordo/shared';
import { Button, buttonVariants, Label } from '@accordo/ui';
import { Bell, Check } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useId, useState, useTransition } from 'react';
import { Link, usePathname, useRouter } from '@/i18n/navigation';
import { api } from '@/lib/api';
import { queryString, withParam } from '@/lib/search';
import { useSession } from '@/lib/session';
import { useErrorMessage } from '@/lib/use-error-message';

export function SearchToolbar({
  basePath,
  query,
  fullQuery,
  name,
}: {
  basePath: string;
  query: SearchQuery;
  /** Query including the path's own filters: what a saved search stores. */
  fullQuery: SearchQuery;
  name: string;
}) {
  const t = useTranslations('Search');
  const router = useRouter();
  const pathname = usePathname();
  const id = useId();
  const errorMessage = useErrorMessage();
  const { data: session } = useSession();
  const [, startTransition] = useTransition();
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const sort = (query.sort as string) ?? (query.q ? 'relevance' : 'newest');
  const sorts = SEARCH_SORTS.filter((s) => (s === 'distance' ? !!query.comune : true));

  async function save() {
    setError(null);
    try {
      const { page: _p, ...rest } = fullQuery;
      await api.post('/api/v1/me/saved-searches', { name, query: rest });
      setSaved(true);
    } catch (e) {
      setError(errorMessage(e));
    }
  }

  return (
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div className="grid gap-1">
        <Label htmlFor={id}>{t('sortBy')}</Label>
        <select
          id={id}
          value={sort}
          onChange={(e) =>
            startTransition(() =>
              router.push(`${basePath}${queryString(withParam(query, 'sort', e.target.value))}`, {
                scroll: false,
              }),
            )
          }
          className="h-10 rounded-md border bg-background px-3 text-sm"
        >
          {sorts.map((s) => (
            <option key={s} value={s}>
              {t(`sort.${s}`)}
            </option>
          ))}
        </select>
      </div>
      <div className="grid justify-items-end gap-1 text-sm">
        {!session ? (
          <Link
            href={`/accedi?next=${encodeURIComponent(pathname + queryString(query))}`}
            className={buttonVariants({ variant: 'outline', size: 'sm' })}
          >
            <Bell aria-hidden />
            {t('saveSearch')}
          </Link>
        ) : saved ? (
          <p role="status" className="flex items-center gap-1">
            <Check aria-hidden className="size-4" />
            {t('searchSaved')}{' '}
            <Link href="/account/ricerche-salvate" className="underline underline-offset-4">
              {t('manageSaved')}
            </Link>
          </p>
        ) : (
          <Button variant="outline" size="sm" onClick={save}>
            <Bell aria-hidden />
            {t('saveSearch')}
          </Button>
        )}
        {error ? (
          <p role="alert" className="text-destructive">
            {error}
          </p>
        ) : null}
      </div>
    </div>
  );
}
