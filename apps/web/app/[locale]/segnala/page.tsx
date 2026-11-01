import { ApiError } from '@accordo/sdk';
import type { ListingDetail, PublicProfile, ShopPublic } from '@accordo/shared';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import type { Locale } from 'next-intl';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { ReportForm } from '@/components/moderation/report-form';
import { Link } from '@/i18n/navigation';
import { serverApi } from '@/lib/server-api';

export const metadata: Metadata = { robots: { index: false, follow: false } };

const TYPES = ['LISTING', 'USER', 'SHOP', 'MESSAGE'] as const;
type Type = (typeof TYPES)[number];

/** Public DSA reporting form; `?tipo=LISTING|USER|SHOP|MESSAGE&id=…` (users and shops by name). */
export default async function ReportPage({ params, searchParams }: PageProps<'/[locale]/segnala'>) {
  setRequestLocale((await params).locale as Locale);
  const t = await getTranslations('Report');
  const sp = await searchParams;
  const type = TYPES.find((x) => x === sp.tipo);
  const ref = typeof sp.id === 'string' ? sp.id : '';
  if (!type || !ref || ref.length > 100) notFound();
  const api = await serverApi();
  const target = await (async (): Promise<{ id: string; label: string } | null> => {
    try {
      if (type === 'LISTING') {
        const l = await api.get<ListingDetail>(`/api/v1/listings/${encodeURIComponent(ref)}`);
        return { id: l.id, label: l.title };
      }
      if (type === 'USER') {
        const u = await api.get<PublicProfile>(`/api/v1/users/${encodeURIComponent(ref)}`);
        return { id: u.id, label: `@${u.username}` };
      }
      if (type === 'SHOP') {
        const s = await api.get<ShopPublic>(`/api/v1/shops/${encodeURIComponent(ref)}`);
        return { id: s.id, label: s.name };
      }
      return /^[0-9a-f-]{36}$/i.test(ref) ? { id: ref, label: t('aMessage') } : null;
    } catch (e) {
      if (e instanceof ApiError && e.status === 404) return null;
      throw e;
    }
  })();
  if (!target) notFound();
  return (
    <div className="mx-auto grid max-w-2xl gap-4 px-4 py-8">
      <h1 className="text-2xl font-bold">{t('title')}</h1>
      <p className="text-muted-foreground">{t('intro')}</p>
      <ReportForm targetType={type as Type} targetId={target.id} label={target.label} />
      <p className="text-sm text-muted-foreground">
        {t('policy')}{' '}
        <Link href="/regole-pubblicazione" className="underline">
          {t('rules')}
        </Link>
      </p>
    </div>
  );
}
