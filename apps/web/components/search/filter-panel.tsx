'use client';
import { type AttributeDef, ITEM_CONDITIONS, type SearchQuery } from '@accordo/shared';
import { Button, Checkbox, cn, Input, Label } from '@accordo/ui';
import { SlidersHorizontal } from 'lucide-react';
import { useTranslations } from 'next-intl';
import {
  type FormEvent,
  type ReactNode,
  useId,
  useOptimistic,
  useState,
  useTransition,
} from 'react';
import { ComuneCombobox, type ComuneValue } from '@/components/comune-combobox';
import { useRouter } from '@/i18n/navigation';
import { queryString, values, withParam } from '@/lib/search';

export interface FilterLabels {
  departments: Record<string, string>;
  categories: Record<string, string>;
  brands: Record<string, string>;
  regions: Array<{ slug: string; name: string }>;
}

interface Props {
  basePath: string;
  /** Parameters chosen by the user (the path's own filters are `locked`). */
  query: SearchQuery;
  locked: string[];
  facets: Record<string, Record<string, number>>;
  labels: FilterLabels;
  attributes: AttributeDef[];
  comune: ComuneValue | null;
}

const RADII = ['10', '30', '50', '100'];
const FLAGS = ['protectedPayment', 'shipping', 'handDelivery', 'topSeller'] as const;
const TOP_BRANDS = 12;

/** Filters live in the URL (SPEC §3.4): every change navigates, so results are shareable. */
export function FilterPanel({
  basePath,
  query: current,
  locked,
  facets,
  labels,
  attributes,
  comune,
}: Props) {
  const t = useTranslations('Search');
  const tc = useTranslations('Condition');
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const panelId = useId();
  // Controls reflect the choice at once, before the navigation completes.
  const [query, setQuery] = useOptimistic(current);
  const go = (q: SearchQuery) =>
    startTransition(() => {
      setQuery(q);
      router.push(`${basePath}${queryString(q)}`, { scroll: false });
    });
  const set = (key: string, value: string | string[] | null) => go(withParam(query, key, value));
  const toggle = (key: string, value: string) => {
    const current = values(query, key);
    set(key, current.includes(value) ? current.filter((v) => v !== value) : [...current, value]);
  };
  const count = (facet: string, value: string) => facets[facet]?.[value];
  const active = Object.keys(query).filter((k) => k !== 'q' && k !== 'sort' && k !== 'page').length;

  function applyRanges(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    let q = query;
    for (const key of ['priceMin', 'priceMax', 'yearMin', 'yearMax'])
      q = withParam(q, key, String(data.get(key) ?? '').trim() || null);
    go(q);
  }

  const brandSlugs = Object.entries(facets.brandSlug ?? {})
    .sort((a, b) => b[1] - a[1])
    .slice(0, TOP_BRANDS)
    .map(([slug]) => slug);
  for (const slug of values(query, 'brand')) if (!brandSlugs.includes(slug)) brandSlugs.push(slug);

  return (
    <div className="grid content-start gap-3">
      <Button
        type="button"
        variant="outline"
        className="lg:hidden"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((o) => !o)}
      >
        <SlidersHorizontal aria-hidden />
        {t('filters')}
        {active ? ` (${active})` : ''}
      </Button>
      <section
        id={panelId}
        aria-label={t('filters')}
        aria-busy={pending}
        className={cn('grid content-start gap-5 text-sm', !open && 'max-lg:hidden')}
      >
        {active ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="justify-self-start"
            onClick={() => go(query.q ? { q: query.q } : {})}
          >
            {t('clearFilters')}
          </Button>
        ) : null}

        {!locked.includes('department') && !query.category ? (
          <FacetRadios
            legend={t('department')}
            name="department"
            selected={values(query, 'department')[0] ?? ''}
            options={Object.keys(facets.departmentSlug ?? {}).map((slug) => ({
              value: slug,
              label: labels.departments[slug] ?? slug,
              count: count('departmentSlug', slug),
            }))}
            allLabel={t('all')}
            onChange={(v) => set('department', v || null)}
          />
        ) : null}

        {!locked.includes('category') ? (
          <FacetRadios
            legend={t('category')}
            name="category"
            selected={values(query, 'category')[0] ?? ''}
            options={Object.keys(facets.categorySlug ?? {}).map((slug) => ({
              value: slug,
              label: labels.categories[slug] ?? slug,
              count: count('categorySlug', slug),
            }))}
            allLabel={t('all')}
            onChange={(v) => set('category', v || null)}
          />
        ) : null}

        {!locked.includes('brand') && brandSlugs.length ? (
          <Group legend={t('brand')}>
            {brandSlugs.map((slug) => (
              <CheckRow
                key={slug}
                label={labels.brands[slug] ?? slug}
                count={count('brandSlug', slug)}
                checked={values(query, 'brand').includes(slug)}
                onChange={() => toggle('brand', slug)}
              />
            ))}
          </Group>
        ) : null}

        <form onSubmit={applyRanges} className="grid gap-3" key={queryString(query)}>
          <Group legend={t('price')}>
            <div className="grid grid-cols-2 gap-2">
              <RangeInput name="priceMin" label={t('min')} value={query.priceMin} suffix="€" />
              <RangeInput name="priceMax" label={t('max')} value={query.priceMax} suffix="€" />
            </div>
          </Group>
          <Group legend={t('year')}>
            <div className="grid grid-cols-2 gap-2">
              <RangeInput name="yearMin" label={t('from')} value={query.yearMin} />
              <RangeInput name="yearMax" label={t('to')} value={query.yearMax} />
            </div>
          </Group>
          <Button type="submit" size="sm" variant="secondary" className="justify-self-start">
            {t('apply')}
          </Button>
        </form>

        <Group legend={t('condition')}>
          {ITEM_CONDITIONS.map((c) => (
            <CheckRow
              key={c}
              label={tc(c)}
              count={count('condition', c)}
              checked={values(query, 'condition').includes(c)}
              onChange={() => toggle('condition', c)}
            />
          ))}
        </Group>

        <Group legend={t('location')}>
          <SelectRow
            label={t('region')}
            value={values(query, 'region')[0] ?? ''}
            onChange={(v) => set('region', v || null)}
            options={[
              { value: '', label: t('allItaly') },
              ...labels.regions.map((r) => ({ value: r.slug, label: r.name })),
            ]}
          />
          <div className="grid gap-1">
            <Label htmlFor={`${panelId}-comune`}>{t('near')}</Label>
            <ComuneCombobox
              id={`${panelId}-comune`}
              value={comune}
              onChange={(c) => {
                let q = withParam(query, 'comune', c?.id ?? null);
                if (c && !query.radiusKm) q = { ...q, radiusKm: '30' };
                if (!c) q = withParam(q, 'radiusKm', null);
                go(q);
              }}
            />
          </div>
          {comune ? (
            <SelectRow
              label={t('radius')}
              value={values(query, 'radiusKm')[0] ?? ''}
              onChange={(v) => set('radiusKm', v || null)}
              options={[
                { value: '', label: t('onlyComune') },
                ...RADII.map((r) => ({ value: r, label: t('km', { km: r }) })),
              ]}
            />
          ) : null}
        </Group>

        <FacetRadios
          legend={t('sellerType')}
          name="sellerType"
          selected={values(query, 'sellerType')[0] ?? ''}
          options={(['PRIVATE', 'BUSINESS'] as const).map((v) => ({
            value: v,
            label: t(`seller.${v}`),
            count: count('sellerType', v),
          }))}
          allLabel={t('all')}
          onChange={(v) => set('sellerType', v || null)}
        />

        <Group legend={t('options')}>
          {FLAGS.map((flag) => (
            <CheckRow
              key={flag}
              label={t(`flag.${flag}`)}
              checked={query[flag] === 'true'}
              onChange={() => set(flag, query[flag] === 'true' ? null : 'true')}
            />
          ))}
        </Group>

        {attributes.map((a) => {
          const facet = facets[`attr.${a.key}`] ?? {};
          const options =
            a.type === 'BOOLEAN'
              ? [
                  { value: 'true', label: t('yes') },
                  { value: 'false', label: t('no') },
                ]
              : (a.options ?? []);
          const available = options.filter((o) => facet[String(o.value)] !== undefined);
          if (!available.length && !query[`attr.${a.key}`]) return null;
          return (
            <SelectRow
              key={a.key}
              label={a.label}
              value={values(query, `attr.${a.key}`)[0] ?? ''}
              onChange={(v) => set(`attr.${a.key}`, v || null)}
              options={[
                { value: '', label: t('any') },
                ...available.map((o) => ({
                  value: String(o.value),
                  label: `${o.label} (${facet[String(o.value)]})`,
                })),
              ]}
            />
          );
        })}
      </section>
    </div>
  );
}

function Group({ legend, children }: { legend: string; children: ReactNode }) {
  return (
    <fieldset className="grid gap-2">
      <legend className="mb-1 font-semibold">{legend}</legend>
      {children}
    </fieldset>
  );
}

function CheckRow({
  label,
  count,
  checked,
  onChange,
}: {
  label: string;
  count?: number;
  checked: boolean;
  onChange: () => void;
}) {
  const id = useId();
  return (
    <div className="flex items-center gap-2">
      <Checkbox id={id} checked={checked} onChange={onChange} />
      <Label htmlFor={id} className="font-normal">
        {label}
        {count !== undefined ? <span className="text-muted-foreground"> ({count})</span> : null}
      </Label>
    </div>
  );
}

function FacetRadios({
  legend,
  name,
  selected,
  options,
  allLabel,
  onChange,
}: {
  legend: string;
  name: string;
  selected: string;
  options: Array<{ value: string; label: string; count?: number }>;
  allLabel: string;
  onChange: (value: string) => void;
}) {
  const id = useId();
  if (!options.length && !selected) return null;
  return (
    <Group legend={legend}>
      {[{ value: '', label: allLabel, count: undefined }, ...options].map((o) => (
        <div key={o.value} className="flex items-center gap-2">
          <input
            type="radio"
            id={`${id}-${o.value}`}
            name={`${id}-${name}`}
            checked={selected === o.value}
            onChange={() => onChange(o.value)}
            className="size-4 accent-primary"
          />
          <Label htmlFor={`${id}-${o.value}`} className="font-normal">
            {o.label}
            {o.count !== undefined ? (
              <span className="text-muted-foreground"> ({o.count})</span>
            ) : null}
          </Label>
        </div>
      ))}
    </Group>
  );
}

function SelectRow({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: Array<{ value: string; label: string }>;
  onChange: (value: string) => void;
}) {
  const id = useId();
  return (
    <div className="grid gap-1">
      <Label htmlFor={id}>{label}</Label>
      <select
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-10 rounded-md border bg-background px-3"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  );
}

function RangeInput({
  name,
  label,
  value,
  suffix,
}: {
  name: string;
  label: string;
  value: string | string[] | undefined;
  suffix?: string;
}) {
  const id = useId();
  return (
    <div className="grid gap-1">
      <Label htmlFor={id} className="font-normal">
        {label}
        {suffix ? ` (${suffix})` : ''}
      </Label>
      <Input
        id={id}
        name={name}
        type="number"
        inputMode="numeric"
        min={0}
        defaultValue={[value ?? []].flat()[0] ?? ''}
      />
    </div>
  );
}
