'use client';
import type {
  AttributeDef,
  DepartmentTree,
  ListingDetail,
  MeResponse,
  PublishResult,
} from '@accordo/shared';
import { Alert, Button, buttonVariants, Card, CardContent } from '@accordo/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useRouter } from '@/i18n/navigation';
import { ApiError, api, problemCode } from '@/lib/api';
import { formatPrice } from '@/lib/format';
import { parseEuroToCents } from '@/lib/price';
import { useErrorMessage } from '@/lib/use-error-message';
import { ImageUploader } from './image-uploader';
import { CategoryStep, DetailsStep, PriceStep } from './steps';
import {
  EMPTY_FORM,
  formFromListing,
  LOCAL_DRAFT_KEY,
  toPayload,
  type WizardForm,
} from './wizard-state';

const STEPS = ['category', 'details', 'photos', 'price', 'preview'] as const;
const REPUBLISHABLE = ['DRAFT', 'EXPIRED', 'REJECTED'];

/** "Vendi" wizard (SPEC §3.3): 5 steps, autosave (localStorage before the draft exists, then PATCH). */
export function SellWizard({ listingId: initialId }: { listingId?: string }) {
  const t = useTranslations('Sell');
  const tv = useTranslations('Validation');
  const errorMessage = useErrorMessage();
  const router = useRouter();
  const qc = useQueryClient();
  const [listingId, setListingId] = useState(initialId ?? null);
  const [step, setStep] = useState(initialId ? 1 : 0);
  const [form, setForm] = useState<WizardForm>(EMPTY_FORM);
  const [errors, setErrors] = useState<Partial<Record<keyof WizardForm, string>>>({});
  const [error, setError] = useState<string | null>(null);
  const [missing, setMissing] = useState<string[]>([]);
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved'>('idle');
  const [restored, setRestored] = useState(false);
  const [result, setResult] = useState<PublishResult | null>(null);
  const loaded = useRef(false);
  const headingRef = useRef<HTMLHeadingElement>(null);

  const { data: departments = [] } = useQuery({
    queryKey: ['departments'],
    queryFn: () => api.get<DepartmentTree[]>('/api/v1/catalog/departments'),
  });
  const { data: me } = useQuery({
    queryKey: ['me'],
    queryFn: () => api.get<MeResponse>('/api/v1/me'),
  });
  const listingQuery = useQuery({
    queryKey: ['listing', listingId],
    queryFn: () => api.get<ListingDetail>(`/api/v1/listings/${listingId}`),
    enabled: !!listingId,
    refetchInterval: (q) => (q.state.data?.images.some((i) => !i.ready) ? 1500 : false),
  });
  const listing = listingQuery.data ?? null;
  const { data: attributes = [] } = useQuery({
    queryKey: ['attributes', form.categoryId],
    queryFn: () =>
      api.get<AttributeDef[]>(`/api/v1/catalog/categories/${form.categoryId}/attributes`),
    enabled: !!form.categoryId,
  });
  const category = departments.flatMap((d) => d.categories).find((c) => c.id === form.categoryId);

  // Initial state: the existing listing, or the local draft, or the profile's comune.
  useEffect(() => {
    if (loaded.current) return;
    if (listingId && listing) {
      setForm(formFromListing(listing));
      loaded.current = true;
    } else if (!listingId && me) {
      try {
        const saved = localStorage.getItem(LOCAL_DRAFT_KEY);
        if (saved) {
          setForm({ ...EMPTY_FORM, ...(JSON.parse(saved) as Partial<WizardForm>) });
          setRestored(true);
        } else setForm((f) => ({ ...f, comune: me.comune }));
      } catch {
        // storage unavailable: start empty
      }
      loaded.current = true;
    }
  }, [listingId, listing, me]);

  const set = useCallback(<K extends keyof WizardForm>(key: K, value: WizardForm[K]) => {
    setForm((f) => ({ ...f, [key]: value, ...(key === 'categoryId' ? { attributes: {} } : {}) }));
    setErrors((e) => ({ ...e, [key]: undefined }));
  }, []);

  const save = useCallback(async () => {
    if (!listingId) return;
    setSaveState('saving');
    const updated = await api.patch<ListingDetail>(
      `/api/v1/listings/${listingId}`,
      toPayload(form),
    );
    qc.setQueryData(['listing', listingId], updated);
    setSaveState('saved');
  }, [form, listingId, qc]);

  // Autosave: debounced PATCH once the draft exists, localStorage before that.
  const serialized = JSON.stringify(form);
  // biome-ignore lint/correctness/useExhaustiveDependencies: keyed on the serialized form only (save/listingId follow it)
  useEffect(() => {
    if (!loaded.current) return;
    const h = setTimeout(() => {
      if (listingId) void save().catch(() => setSaveState('idle'));
      else {
        try {
          localStorage.setItem(LOCAL_DRAFT_KEY, serialized);
        } catch {
          // ignore
        }
      }
    }, 1200);
    return () => clearTimeout(h);
  }, [serialized]);

  function validate(current: number): boolean {
    const e: typeof errors = {};
    if (current === 0) {
      if (form.title.trim().length < 3) e.title = tv('TITLE_TOO_SHORT');
      if (!form.categoryId) e.categoryId = tv('CATEGORY_REQUIRED');
    }
    if (current === 1 && !form.condition) e.condition = tv('required');
    if (current === 1 && !listingId && !form.comune) e.comune = tv('required');
    if (current === 3) {
      if (parseEuroToCents(form.price) === null) e.price = tv('PRICE_INVALID');
      if (form.shippingSelf && parseEuroToCents(form.selfShippingPrice) === null)
        e.selfShippingPrice = tv('PRICE_INVALID');
      if (!form.comune) e.comune = tv('required');
    }
    setErrors(e);
    return Object.keys(e).length === 0;
  }

  async function go(next: number) {
    setError(null);
    if (next > step && !validate(step)) return;
    try {
      if (!listingId && step === 1 && next > step) {
        const created = await api.post<ListingDetail>('/api/v1/listings', toPayload(form));
        qc.setQueryData(['listing', created.id], created);
        setListingId(created.id);
        try {
          localStorage.removeItem(LOCAL_DRAFT_KEY);
        } catch {
          // ignore
        }
      } else if (listingId) {
        await save();
      }
      if (next === 3 && !form.parcelSize && category?.defaultParcelSize)
        set('parcelSize', category.defaultParcelSize);
      setStep(next);
      requestAnimationFrame(() => headingRef.current?.focus());
    } catch (e) {
      setError(errorMessage(e));
    }
  }

  async function publish() {
    if (!listingId) return;
    setError(null);
    setMissing([]);
    try {
      await save();
      if (listing && !REPUBLISHABLE.includes(listing.status)) {
        router.push(`/annuncio/${listing.slug}-${listing.shortId}`);
        return;
      }
      setResult(await api.post<PublishResult>(`/api/v1/listings/${listingId}/publish`));
      await listingQuery.refetch();
    } catch (e) {
      if (problemCode(e) === 'LISTING_INCOMPLETE' && e instanceof ApiError)
        setMissing((e.problem.detail ?? '').split(','));
      else setError(errorMessage(e));
    }
  }

  if (result && listing) {
    return (
      <Card>
        <CardContent className="grid gap-4 pt-6">
          <Alert tone={result.status === 'ACTIVE' ? 'success' : 'info'}>
            {result.status === 'ACTIVE' ? t('published') : t('pendingReview')}
          </Alert>
          <div className="flex flex-wrap gap-2">
            {result.status === 'ACTIVE' ? (
              <Link
                href={`/annuncio/${listing.slug}-${listing.shortId}`}
                className={buttonVariants()}
              >
                {t('goToListing')}
              </Link>
            ) : null}
            <Link href="/account/annunci" className={buttonVariants({ variant: 'outline' })}>
              {t('goToMyListings')}
            </Link>
          </div>
        </CardContent>
      </Card>
    );
  }

  const stepKey = STEPS[step] as (typeof STEPS)[number];
  return (
    <div className="grid gap-6">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-sm text-muted-foreground">
          {t('stepOf', { step: step + 1, total: STEPS.length })}
        </p>
        <p aria-live="polite" className="text-sm text-muted-foreground">
          {saveState === 'saving' ? t('saving') : saveState === 'saved' ? t('savedAt') : ''}
        </p>
      </div>
      <ol className="flex gap-1" aria-hidden>
        {STEPS.map((s, i) => (
          <li key={s} className={`h-1 flex-1 rounded ${i <= step ? 'bg-primary' : 'bg-muted'}`} />
        ))}
      </ol>
      <h2 ref={headingRef} tabIndex={-1} className="text-xl font-semibold outline-none">
        {t(`steps.${stepKey}`)}
      </h2>
      {restored && step === 0 ? <Alert>{t('draftRestored')}</Alert> : null}
      {error ? <Alert tone="error">{error}</Alert> : null}

      {stepKey === 'category' ? (
        <CategoryStep form={form} set={set} errors={errors} departments={departments} />
      ) : null}
      {stepKey === 'details' ? (
        <DetailsStep
          form={form}
          set={set}
          errors={errors}
          attributes={attributes}
          needsComune={!listingId && !me?.comune}
        />
      ) : null}
      {stepKey === 'photos' && listingId ? (
        <ImageUploader
          listingId={listingId}
          images={listing?.images ?? []}
          onChange={() => listingQuery.refetch()}
        />
      ) : null}
      {stepKey === 'price' ? (
        <PriceStep form={form} set={set} errors={errors} shippable={category?.shippable ?? true} />
      ) : null}
      {stepKey === 'preview' && listing ? <Preview listing={listing} missing={missing} /> : null}

      <div className="flex justify-between gap-2">
        <Button variant="outline" disabled={step === 0} onClick={() => go(step - 1)}>
          {t('back')}
        </Button>
        {step < STEPS.length - 1 ? (
          <Button onClick={() => go(step + 1)}>{t('next')}</Button>
        ) : (
          <Button onClick={publish}>
            {listing && !REPUBLISHABLE.includes(listing.status) ? t('saveChanges') : t('publish')}
          </Button>
        )}
      </div>
    </div>
  );
}

function Preview({ listing, missing }: { listing: ListingDetail; missing: string[] }) {
  const t = useTranslations('Sell');
  const tc = useTranslations('Condition');
  return (
    <div className="grid gap-4">
      <p className="text-muted-foreground">{t('previewIntro')}</p>
      {missing.length ? (
        <Alert tone="error">
          <strong>{t('missing.title')}</strong>
          <ul className="mt-1 list-disc pl-5">
            {missing.map((m) => (
              <li key={m}>
                {t.has(`missing.${m}` as 'missing.images')
                  ? t(`missing.${m}` as 'missing.images')
                  : m}
              </li>
            ))}
          </ul>
        </Alert>
      ) : null}
      <Card>
        <CardContent className="grid gap-2 pt-6">
          <p className="text-sm text-muted-foreground">
            {listing.category.department.name} › {listing.category.name}
          </p>
          <h3 className="text-xl font-semibold">{listing.title}</h3>
          <p className="text-2xl font-bold">{formatPrice(listing.priceCents)}</p>
          <p className="text-sm">
            {tc(listing.condition)} · {listing.location.comune} ({listing.location.provinciaSigla})
          </p>
          {listing.attributes.length ? (
            <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
              {listing.attributes.map((a) => (
                <div key={a.key} className="contents">
                  <dt className="text-muted-foreground">{a.label}</dt>
                  <dd>
                    {a.value}
                    {a.unit ? ` ${a.unit}` : ''}
                  </dd>
                </div>
              ))}
            </dl>
          ) : null}
          <p className="whitespace-pre-line text-sm">{listing.description}</p>
        </CardContent>
      </Card>
    </div>
  );
}
