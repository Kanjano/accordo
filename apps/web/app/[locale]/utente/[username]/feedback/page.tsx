import { ApiError } from '@accordo/sdk';
import type { FeedbackItem, ReputationDto } from '@accordo/shared';
import { Trophy } from 'lucide-react';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import type { Locale } from 'next-intl';
import { getFormatter, getTranslations, setRequestLocale } from 'next-intl/server';
import { cache } from 'react';
import { FeedbackEntry } from '@/components/feedback/feedback-entry';
import { LevelIcon } from '@/components/feedback/level-icon';
import { Link } from '@/i18n/navigation';
import { serverApi } from '@/lib/server-api';

type Props = PageProps<'/[locale]/utente/[username]/feedback'>;

const loadReputation = cache(async (username: string) => {
  try {
    return await (await serverApi()).get<ReputationDto>(
      `/api/v1/users/${encodeURIComponent(username)}/reputation`,
    );
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) notFound();
    throw e;
  }
});

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const t = await getTranslations('Reputation');
  const rep = await loadReputation((await params).username);
  return {
    title: `${t('pageTitle', { name: rep.username })} | Accordo`,
    robots: { index: false, follow: true },
  };
}

const FILTERS = ['seller', 'buyer', 'left'] as const;

/** SPEC §8.9: summary at 1/6/12 months, detailed ratings, filterable list. */
export default async function FeedbackPage({ params, searchParams }: Props) {
  const { locale, username } = await params;
  setRequestLocale(locale as Locale);
  const q = await searchParams;
  const role = FILTERS.includes(q.role as never) ? (q.role as string) : 'seller';
  const rating = typeof q.rating === 'string' ? q.rating : '';
  const t = await getTranslations('Reputation');
  const tf = await getTranslations('Feedback');
  const format = await getFormatter();
  const rep = await loadReputation(username);
  const query = new URLSearchParams({
    role,
    ...(rating ? { rating } : {}),
    ...(typeof q.cursor === 'string' ? { cursor: q.cursor } : {}),
  });
  const list = await (await serverApi()).get<{ items: FeedbackItem[]; nextCursor: string | null }>(
    `/api/v1/users/${encodeURIComponent(username)}/feedback?${query}`,
  );
  const pct = rep.sellerPositivePctBps;
  const href = (o: Record<string, string>) =>
    `/utente/${username}/feedback?${new URLSearchParams({ role, ...(rating ? { rating } : {}), ...o })}`;

  return (
    <div className="mx-auto grid max-w-4xl gap-6 px-4 py-8">
      <header className="grid gap-1">
        <h1 className="flex items-center gap-2 text-2xl font-bold">
          {t('pageTitle', { name: rep.username })}
          <LevelIcon levelKey={rep.levelKey} className="size-6" />
        </h1>
        <p className="text-sm">
          {t('score', { score: rep.score })}
          {rep.levelKey ? ` · ${t(`levels.${rep.levelKey as 'NEWCOMER'}`)}` : ''} ·{' '}
          {pct === null
            ? t('noFeedback')
            : t('positive', {
                pct: format.number(pct / 10_000, {
                  style: 'percent',
                  minimumFractionDigits: 1,
                  maximumFractionDigits: 1,
                }),
              })}
        </p>
        {rep.topSeller ? (
          <p className="flex items-center gap-1 text-sm font-medium">
            <Trophy aria-hidden className="size-4 text-amber-600" />
            {t('topSeller')}
          </p>
        ) : null}
        <Link href={`/utente/${username}`} className="text-sm underline underline-offset-4">
          {t('backToProfile')}
        </Link>
      </header>

      <div className="grid gap-6 md:grid-cols-2">
        <section aria-labelledby="summary">
          <h2 id="summary" className="mb-2 font-semibold">
            {t('summary')}
          </h2>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-muted-foreground">
                <th scope="col" className="py-1 font-normal">
                  <span className="sr-only">{t('ratingCol')}</span>
                </th>
                {(['m1', 'm6', 'm12'] as const).map((p) => (
                  <th key={p} scope="col" className="py-1 text-right font-normal">
                    {t(`period.${p}`)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {(['positive', 'neutral', 'negative'] as const).map((r) => (
                <tr key={r} className="border-t">
                  <th scope="row" className="py-1 text-left font-normal">
                    {t(`row.${r}`)}
                  </th>
                  {(['m1', 'm6', 'm12'] as const).map((p) => (
                    <td key={p} className="py-1 text-right">
                      {rep.periods[p][r]}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </section>
        <section aria-labelledby="dsr">
          <h2 id="dsr" className="mb-2 font-semibold">
            {t('dsrTitle')}
          </h2>
          <ul className="grid gap-2 text-sm">
            {(['itemAsDescribed', 'communication', 'shippingTime', 'packaging'] as const).map(
              (k) => {
                const d = rep.dsr[k];
                return (
                  <li key={k} className="grid gap-1">
                    <span className="flex justify-between">
                      {tf(`dsr.${k}`)}
                      <span className="text-muted-foreground">
                        {d
                          ? t('dsrValue', {
                              avg: format.number(d.avg, { maximumFractionDigits: 1 }),
                              count: d.count,
                            })
                          : t('dsrFew')}
                      </span>
                    </span>
                    <span className="h-2 rounded bg-muted" aria-hidden>
                      <span
                        className="block h-2 rounded bg-amber-500"
                        style={{ width: `${d ? (d.avg / 5) * 100 : 0}%` }}
                      />
                    </span>
                  </li>
                );
              },
            )}
          </ul>
        </section>
      </div>

      <section aria-labelledby="list" className="grid gap-3">
        <h2 id="list" className="font-semibold">
          {t('listTitle')}
        </h2>
        <nav aria-label={t('filters')} className="flex flex-wrap gap-2 text-sm">
          {FILTERS.map((r) => (
            <Link
              key={r}
              href={`/utente/${username}/feedback?role=${r}`}
              aria-current={r === role ? 'page' : undefined}
              className={`rounded-full border px-3 py-1 ${r === role ? 'bg-accent font-medium' : ''}`}
            >
              {t(`filter.${r}`)}
            </Link>
          ))}
          {(['', 'POSITIVE', 'NEUTRAL', 'NEGATIVE'] as const).map((r) => (
            <Link
              key={r || 'all'}
              href={href({ rating: r })}
              aria-current={r === rating ? 'page' : undefined}
              className={`rounded-full border px-3 py-1 ${r === rating ? 'bg-accent font-medium' : ''}`}
            >
              {r ? tf(`rating.${r}`) : t('allRatings')}
            </Link>
          ))}
        </nav>
        {list.items.length ? (
          <ul className="grid gap-3">
            {list.items.map((f) => (
              <li key={f.id}>
                <FeedbackEntry item={f} />
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-muted-foreground">{t('emptyList')}</p>
        )}
        {list.nextCursor ? (
          <Link
            href={href({ cursor: list.nextCursor })}
            className="justify-self-center underline underline-offset-4"
          >
            {t('more')}
          </Link>
        ) : null}
        <Link href="/come-funzionano-i-feedback" className="text-sm underline underline-offset-4">
          {tf('howItWorks')}
        </Link>
      </section>
    </div>
  );
}
