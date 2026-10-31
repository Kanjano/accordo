import { ApiError } from '@accordo/sdk';
import type { ListingCardItem, Page, PublicProfile } from '@accordo/shared';
import { BadgeCheck, Mail, ShieldCheck, Store, Trophy } from 'lucide-react';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import type { Locale } from 'next-intl';
import { getFormatter, getTranslations, setRequestLocale } from 'next-intl/server';
import { cache } from 'react';
import { LevelIcon } from '@/components/feedback/level-icon';
import { ListingCard } from '@/components/profile/listing-card';
import { ProfileActions } from '@/components/profile/profile-actions';
import { Link } from '@/i18n/navigation';
import { serverApi } from '@/lib/server-api';

const load = cache(async (username: string) => {
  const api = await serverApi();
  try {
    const [profile, listings] = await Promise.all([
      api.get<PublicProfile>(`/api/v1/users/${encodeURIComponent(username)}`),
      api.get<Page<ListingCardItem>>(
        `/api/v1/users/${encodeURIComponent(username)}/listings?limit=24`,
      ),
    ]);
    return { profile, listings };
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) notFound();
    throw e;
  }
});

export async function generateMetadata({
  params,
}: PageProps<'/[locale]/utente/[username]'>): Promise<Metadata> {
  const { profile } = await load((await params).username);
  return { title: `${profile.displayName} (@${profile.username}) — Accordo` };
}

export default async function ProfilePage({ params }: PageProps<'/[locale]/utente/[username]'>) {
  const { locale, username } = await params;
  setRequestLocale(locale as Locale);
  const t = await getTranslations('Profile');
  const format = await getFormatter();
  const { profile: p, listings } = await load(username);
  const pct = p.reputation.sellerPositivePctBps;
  const badges = [
    p.badges.emailVerified && { icon: Mail, label: t('badges.emailVerified') },
    p.badges.identityVerified && { icon: ShieldCheck, label: t('badges.identityVerified') },
    p.badges.shopVerified && { icon: Store, label: t('badges.shopVerified') },
    p.badges.topSeller && { icon: Trophy, label: t('badges.topSeller') },
  ].filter((b): b is { icon: typeof Mail; label: string } => !!b);

  return (
    <div className="mx-auto grid max-w-6xl gap-8 px-4 py-8">
      <section className="grid gap-4 rounded-xl border bg-card p-6 md:grid-cols-[1fr_auto]">
        <div className="grid gap-2">
          <h1 className="text-2xl font-bold">
            {p.displayName}{' '}
            <LevelIcon levelKey={p.badges.levelKey} className="inline size-5 align-baseline" />{' '}
            <span className="text-base font-normal text-muted-foreground">@{p.username}</span>
          </h1>
          <p className="text-sm text-muted-foreground">
            {[
              p.location && `${p.location.comune} (${p.location.provinciaSigla})`,
              t('memberSince', {
                date: format.dateTime(new Date(p.memberSince), { month: 'long', year: 'numeric' }),
              }),
              p.activity && t(`activity.${p.activity}`),
              p.responseTime && t(`responseTime.${p.responseTime}`),
            ]
              .filter(Boolean)
              .join(' · ')}
          </p>
          {p.accountType === 'BUSINESS' ? (
            <p className="text-sm font-medium">{t('business')}</p>
          ) : null}
          {p.bio ? <p className="max-w-prose whitespace-pre-line">{p.bio}</p> : null}
          {badges.length ? (
            <ul aria-label={t('badges.label')} className="flex flex-wrap gap-2">
              {badges.map(({ icon: Icon, label }) => (
                <li
                  key={label}
                  className="inline-flex items-center gap-1 rounded-full bg-secondary px-3 py-1 text-xs"
                >
                  <Icon aria-hidden className="size-3.5" />
                  {label}
                </li>
              ))}
            </ul>
          ) : null}
          <ProfileActions
            userId={p.id}
            username={p.username}
            isFollowing={p.viewer?.isFollowing ?? false}
            isBlocked={p.viewer?.isBlocked ?? false}
            isSelf={p.viewer?.isSelf ?? false}
          />
        </div>
        <dl className="grid content-start gap-2 text-sm md:min-w-56">
          <div>
            <dt className="font-medium">{t('feedback')}</dt>
            <dd className="flex items-center gap-1">
              <BadgeCheck aria-hidden className="size-4 text-primary" />
              {pct === null
                ? t('noFeedback')
                : t('positive', {
                    pct: format.number(pct / 10_000, {
                      style: 'percent',
                      minimumFractionDigits: 1,
                      maximumFractionDigits: 1,
                    }),
                  })}
            </dd>
            {pct !== null ? (
              <dd className="text-muted-foreground">
                {t('feedbackCounts', {
                  positive: p.reputation.sellerPositive12m,
                  neutral: p.reputation.sellerNeutral12m,
                  negative: p.reputation.sellerNegative12m,
                })}
              </dd>
            ) : null}
          </div>
          <dt className="sr-only">{t('badges.label')}</dt>
          <dd>
            {t('score', { score: p.reputation.score })}
            {p.badges.levelKey
              ? ` · ${t('level', { level: t(`levels.${p.badges.levelKey}` as 'levels.NEWCOMER') })}`
              : ''}
          </dd>
          <dd>
            {t('sales', { count: p.reputation.completedSales })} ·{' '}
            {t('purchases', { count: p.reputation.completedPurchases })}
          </dd>
          <dd>{t('followers', { count: p.followersCount })}</dd>
          <dd>
            <Link href={`/utente/${p.username}/feedback`} className="underline underline-offset-4">
              {t('allFeedback')}
            </Link>
          </dd>
        </dl>
      </section>

      <section aria-labelledby="listings-title" className="grid gap-4">
        <h2 id="listings-title" className="text-xl font-semibold">
          {t('listings', { count: p.activeListingsCount })}
        </h2>
        {listings.items.length === 0 ? (
          <p className="text-muted-foreground">{t('noListings')}</p>
        ) : (
          <ul className="grid grid-cols-2 gap-4 md:grid-cols-4">
            {listings.items.map((item) => (
              <li key={item.id}>
                <Link
                  href={`/annuncio/${item.slug}-${item.shortId}`}
                  className="block rounded-xl focus-visible:outline-2 focus-visible:outline-ring"
                >
                  <ListingCard item={item} />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
