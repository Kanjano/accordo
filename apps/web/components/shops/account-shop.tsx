'use client';
import { isValidPartitaIva } from '@accordo/domain';
import { type MyShop, shopApplySchema, type UploadUrlResponse } from '@accordo/shared';
import { Alert, Button, Checkbox, Field, Input, Textarea } from '@accordo/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { type FormEvent, useId, useState } from 'react';
import { ComuneCombobox, type ComuneValue } from '@/components/comune-combobox';
import { Link } from '@/i18n/navigation';
import { ApiError, api } from '@/lib/api';
import { mediaSrcSet } from '@/lib/format';
import { postToStorage, prepareForUpload } from '@/lib/image-resize';
import { useErrorMessage, useValidationMessage } from '@/lib/use-error-message';

const STATUS_TONE = { PENDING: 'info', VERIFIED: 'success', REJECTED: 'error' } as const;

/** "Diventa negozio" and shop settings (SPEC §3.8). */
export function AccountShop() {
  const t = useTranslations('Shops');
  const errorMessage = useErrorMessage();
  const { data, error, isPending } = useQuery({
    queryKey: ['my-shop'],
    queryFn: () =>
      api.get<MyShop>('/api/v1/me/shop').catch((e) => {
        if (e instanceof ApiError && e.status === 404) return null;
        throw e;
      }),
  });
  if (isPending) return null;
  if (error) return <Alert tone="error">{errorMessage(error)}</Alert>;
  return (
    <div className="grid gap-6">
      <h1 className="text-2xl font-bold">{data ? t('myShop') : t('become')}</h1>
      {data ? (
        <>
          <Alert tone={STATUS_TONE[data.status]}>
            {t(`status.${data.status}`)}
            {data.rejectionReason ? ` ${t('reason')}: ${data.rejectionReason}` : null}
          </Alert>
          {data.status === 'VERIFIED' ? (
            <Link href={`/negozio/${data.slug}`} className="text-sm underline">
              {t('viewStorefront')}
            </Link>
          ) : null}
          <ShopMedia shop={data} />
        </>
      ) : (
        <p className="max-w-prose text-muted-foreground">{t('becomeIntro')}</p>
      )}
      <ShopForm shop={data} />
    </div>
  );
}

function ShopForm({ shop }: { shop: MyShop | null }) {
  const t = useTranslations('Shops');
  const tc = useTranslations('Common');
  const v = useValidationMessage();
  const errorMessage = useErrorMessage();
  const qc = useQueryClient();
  const [comune, setComune] = useState<ComuneValue | null>(shop?.comune ?? null);
  const [errors, setErrors] = useState<Record<string, string | undefined>>({});
  const [saved, setSaved] = useState(false);
  const locked = shop?.status === 'VERIFIED';
  const save = useMutation({
    mutationFn: (body: object) =>
      shop ? api.patch<MyShop>('/api/v1/me/shop', body) : api.post<MyShop>('/api/v1/shops', body),
    onSuccess: (s) => {
      qc.setQueryData(['my-shop'], s);
      setSaved(true);
    },
  });

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSaved(false);
    const f = new FormData(e.currentTarget);
    const str = (k: string) => String(f.get(k) ?? '');
    const input = {
      name: str('name'),
      legalName: str('legalName'),
      vatNumber: str('vatNumber'),
      reaNumber: str('reaNumber'),
      pec: str('pec'),
      email: str('email'),
      phone: str('phone'),
      website: str('website'),
      addressLine: str('addressLine'),
      cap: str('cap'),
      comuneId: comune?.id ?? '',
      description: str('description'),
      openingHours: str('openingHours'),
      returnPolicy: str('returnPolicy'),
      warrantyInfo: str('warrantyInfo'),
      traderSelfCertified: shop ? true : f.get('traderSelfCertified') === 'on',
    };
    const parsed = shopApplySchema.safeParse(input);
    const issues: Record<string, string | undefined> = parsed.success
      ? {}
      : Object.fromEntries(
          parsed.error.issues.map((i) => [
            String(i.path[0]),
            v(i.message.startsWith('Invalid') ? 'required' : i.message),
          ]),
        );
    if (parsed.success && !isValidPartitaIva(parsed.data.vatNumber))
      issues.vatNumber = v('VAT_INVALID');
    setErrors(issues);
    if (!parsed.success || issues.vatNumber) return;
    const { traderSelfCertified, ...rest } = parsed.data;
    save.mutate(
      shop
        ? locked
          ? Object.fromEntries(
              Object.entries(rest).filter(
                ([k]) => !['legalName', 'vatNumber', 'addressLine', 'cap', 'comuneId'].includes(k),
              ),
            )
          : rest
        : { ...rest, traderSelfCertified },
    );
  }

  return (
    <form onSubmit={onSubmit} className="grid gap-4" noValidate>
      {save.isError ? <Alert tone="error">{errorMessage(save.error)}</Alert> : null}
      {saved ? <Alert tone="success">{t('saved')}</Alert> : null}
      <fieldset className="grid gap-4 rounded-lg border p-4">
        <legend className="px-1 font-semibold">{t('legalSection')}</legend>
        {locked ? <p className="text-sm text-muted-foreground">{t('legalLocked')}</p> : null}
        <Field label={t('fields.legalName')} error={errors.legalName}>
          <Input name="legalName" defaultValue={shop?.legalName} readOnly={locked} />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t('fields.vatNumber')} error={errors.vatNumber}>
            <Input
              name="vatNumber"
              defaultValue={shop?.vatNumber}
              inputMode="numeric"
              maxLength={13}
              readOnly={locked}
            />
          </Field>
          <Field label={`${t('fields.reaNumber')} (${tc('optional')})`} error={errors.reaNumber}>
            <Input name="reaNumber" defaultValue={shop?.reaNumber ?? ''} />
          </Field>
        </div>
        <Field label={t('fields.addressLine')} error={errors.addressLine}>
          <Input
            name="addressLine"
            defaultValue={shop?.addressLine}
            autoComplete="street-address"
            readOnly={locked}
          />
        </Field>
        <div className="grid gap-4 sm:grid-cols-[8rem_1fr]">
          <Field label={t('fields.cap')} error={errors.cap}>
            <Input
              name="cap"
              defaultValue={shop?.cap}
              inputMode="numeric"
              maxLength={5}
              autoComplete="postal-code"
              readOnly={locked}
            />
          </Field>
          <Field label={t('fields.comune')} error={errors.comuneId}>
            {locked ? (
              <Input readOnly value={`${shop?.comune.name} (${shop?.comune.provinciaSigla})`} />
            ) : (
              <ComuneCombobox value={comune} onChange={setComune} />
            )}
          </Field>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t('fields.email')} error={errors.email}>
            <Input name="email" type="email" defaultValue={shop?.email} autoComplete="email" />
          </Field>
          <Field label={t('fields.phone')} error={errors.phone}>
            <Input name="phone" type="tel" defaultValue={shop?.phone} autoComplete="tel" />
          </Field>
          <Field label={`${t('fields.pec')} (${tc('optional')})`} error={errors.pec}>
            <Input name="pec" type="email" defaultValue={shop?.pec ?? ''} />
          </Field>
          <Field label={`${t('fields.website')} (${tc('optional')})`} error={errors.website}>
            <Input name="website" type="url" defaultValue={shop?.website ?? ''} />
          </Field>
        </div>
      </fieldset>
      <fieldset className="grid gap-4 rounded-lg border p-4">
        <legend className="px-1 font-semibold">{t('storefrontSection')}</legend>
        <Field label={t('fields.name')} error={errors.name}>
          <Input name="name" defaultValue={shop?.name} autoComplete="organization" />
        </Field>
        <Field label={`${t('fields.description')} (${tc('optional')})`} error={errors.description}>
          <Textarea
            name="description"
            rows={4}
            maxLength={2000}
            defaultValue={shop?.description ?? ''}
          />
        </Field>
        <Field
          label={`${t('fields.openingHours')} (${tc('optional')})`}
          description={t('openingHoursHelp')}
          error={errors.openingHours}
        >
          <Textarea
            name="openingHours"
            rows={3}
            maxLength={500}
            defaultValue={shop?.openingHours ?? ''}
          />
        </Field>
        <Field
          label={t('fields.returnPolicy')}
          description={t('returnPolicyHelp')}
          error={errors.returnPolicy}
        >
          <Textarea
            name="returnPolicy"
            rows={3}
            maxLength={2000}
            defaultValue={shop?.returnPolicy ?? ''}
          />
        </Field>
        <Field
          label={t('fields.warrantyInfo')}
          description={t('warrantyInfoHelp')}
          error={errors.warrantyInfo}
        >
          <Textarea
            name="warrantyInfo"
            rows={3}
            maxLength={2000}
            defaultValue={shop?.warrantyInfo ?? ''}
          />
        </Field>
      </fieldset>
      {shop ? null : (
        <div className="grid gap-1">
          <label className="flex items-start gap-2 text-sm">
            <Checkbox name="traderSelfCertified" className="mt-0.5" />
            {t('selfCert')}
          </label>
          {errors.traderSelfCertified ? (
            <p className="text-sm text-destructive">{errors.traderSelfCertified}</p>
          ) : null}
        </div>
      )}
      <Button type="submit" className="justify-self-start" disabled={save.isPending}>
        {shop ? tc('save') : t('submit')}
      </Button>
    </form>
  );
}

function ShopMedia({ shop }: { shop: MyShop }) {
  const t = useTranslations('Shops');
  const errorMessage = useErrorMessage();
  const id = useId();
  const [state, setState] = useState<{ kind: string; msg: string } | null>(null);

  async function upload(kind: 'logo' | 'cover', file: File | undefined) {
    if (!file) return;
    setState(null);
    try {
      const blob = await prepareForUpload(file);
      const target = await api.post<UploadUrlResponse>('/api/v1/media/upload-url', {
        contentType: 'image/jpeg',
        size: blob.size,
      });
      await postToStorage(target.url, target.fields, blob, () => undefined);
      await api.post('/api/v1/me/shop/media', { kind, key: target.key });
      setState({ kind, msg: t('mediaProcessing') });
    } catch (e) {
      setState({ kind, msg: errorMessage(e) });
    }
  }

  return (
    <section className="grid gap-4 sm:grid-cols-2" aria-label={t('mediaSection')}>
      {(['logo', 'cover'] as const).map((kind) => {
        const key = kind === 'logo' ? shop.logoKey : shop.coverKey;
        return (
          <div key={kind} className="grid content-start gap-2 rounded-lg border p-4 text-sm">
            <label htmlFor={`${id}-${kind}`} className="font-medium">
              {t(`fields.${kind}`)}
            </label>
            {key ? (
              // biome-ignore lint/performance/noImgElement: pre-generated variants on the media CDN
              <img
                {...mediaSrcSet(key)}
                alt=""
                className={
                  kind === 'logo'
                    ? 'size-20 rounded object-cover'
                    : 'h-24 w-full rounded object-cover'
                }
              />
            ) : null}
            <input
              id={`${id}-${kind}`}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              onChange={(e) => upload(kind, e.target.files?.[0])}
            />
            {state?.kind === kind ? <p role="status">{state.msg}</p> : null}
          </div>
        );
      })}
    </section>
  );
}
