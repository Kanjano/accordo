import type { ShopDirectoryItem } from '@accordo/shared';
import { Button, Input } from '@accordo/ui';
import { Store } from 'lucide-react';
import type { Metadata } from 'next';
import type { Locale } from 'next-intl';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { mediaSrcSet } from '@/lib/format';
import { cachedApi } from '@/lib/server-api';

interface Directory {
  items: ShopDirectoryItem[];
  total: number;
  page: number;
  perPage: number;
}

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('Shops');
  return { title: `${t('directoryTitle')} | Accordo`, alternates: { canonical: '/negozi' } };
}

/** Verified shops, filterable by region (SPEC §3.8). */
export default async function ShopsPage({ params, searchParams }: PageProps<'/[locale]/negozi'>) {
  setRequestLocale((await params).locale as Locale);
  const t = await getTranslations('Shops');
  const sp = await searchParams;
  const one = (v: string | string[] | undefined) => (typeof v === 'string' ? v : '');
  const region = one(sp.regione);
  const q = one(sp.q);
  const page = Number(one(sp.pagina)) || 1;
  const api = cachedApi();
  const [regions, dir] = await Promise.all([
    api.get<Array<{ slug: string; name: string }>>('/api/v1/geo/regioni'),
    api.get<Directory>(
      `/api/v1/shops?${new URLSearchParams({ region, q, page: String(page) }).toString()}`,
    ),
  ]);
  const pages = Math.ceil(dir.total / dir.perPage);
  const href = (p: number) =>
    `/negozi?${new URLSearchParams({ ...(region && { regione: region }), ...(q && { q }), pagina: String(p) }).toString()}`;

  return (
    <div className="mx-auto grid max-w-6xl gap-6 px-4 py-8">
      <h1 className="text-2xl font-bold">{t('directoryTitle')}</h1>
      <p className="max-w-prose text-muted-foreground">{t('directoryIntro')}</p>
      <form className="flex flex-wrap items-end gap-3" action="/negozi">
        <label className="grid gap-1 text-sm">
          {t('region')}
          <select
            name="regione"
            defaultValue={region}
            className="h-10 rounded-md border border-input bg-background px-3"
          >
            <option value="">{t('allRegions')}</option>
            {regions.map((r) => (
              <option key={r.slug} value={r.slug}>
                {r.name}
              </option>
            ))}
          </select>
        </label>
        <label className="grid gap-1 text-sm">
          {t('searchName')}
          <Input name="q" defaultValue={q} maxLength={80} />
        </label>
        <Button type="submit">{t('filter')}</Button>
      </form>
      <p className="text-sm text-muted-foreground" role="status">
        {t('count', { count: dir.total })}
      </p>
      <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {dir.items.map((s) => (
          <li key={s.slug}>
            <Link
              href={`/negozio/${s.slug}`}
              className="flex items-center gap-3 rounded-xl border p-4 hover:bg-accent"
            >
              {s.logoKey ? (
                // biome-ignore lint/performance/noImgElement: pre-generated variants on the media CDN
                <img
                  src={mediaSrcSet(s.logoKey).src}
                  alt=""
                  className="size-14 rounded object-cover"
                />
              ) : (
                <span className="grid size-14 place-items-center rounded bg-muted">
                  <Store aria-hidden className="size-6" />
                </span>
              )}
              <span className="grid">
                <strong>{s.name}</strong>
                <span className="text-sm text-muted-foreground">
                  {s.comune} ({s.provinciaSigla}) · {s.regione}
                </span>
                <span className="text-sm">{t('activeListings', { count: s.activeListings })}</span>
              </span>
            </Link>
          </li>
        ))}
      </ul>
      {pages > 1 ? (
        <nav aria-label={t('pagination')} className="flex gap-3 text-sm">
          {page > 1 ? <Link href={href(page - 1)}>{t('prev')}</Link> : null}
          <span>{t('pageOf', { page, pages })}</span>
          {page < pages ? <Link href={href(page + 1)}>{t('next')}</Link> : null}
        </nav>
      ) : null}
    </div>
  );
}
