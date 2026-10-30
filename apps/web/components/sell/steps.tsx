'use client';
import {
  type AttributeDef,
  type BrandOption,
  type DepartmentTree,
  ITEM_CONDITIONS,
  PARCEL_SIZES,
} from '@accordo/shared';
import { Checkbox, cn, Field, Input, Textarea } from '@accordo/ui';
import { useQuery } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { type KeyboardEvent, useEffect, useId, useState } from 'react';
import { ComuneCombobox } from '@/components/comune-combobox';
import { api } from '@/lib/api';
import type { WizardForm } from './wizard-state';

type Set = <K extends keyof WizardForm>(key: K, value: WizardForm[K]) => void;
interface StepProps {
  form: WizardForm;
  set: Set;
  errors: Partial<Record<keyof WizardForm, string>>;
}

// ───────────── Step 1: category ─────────────

export function CategoryStep({
  form,
  set,
  errors,
  departments,
}: StepProps & { departments: DepartmentTree[] }) {
  const t = useTranslations('Sell');
  const [query, setQuery] = useState(form.title);
  useEffect(() => {
    const h = setTimeout(() => setQuery(form.title), 300);
    return () => clearTimeout(h);
  }, [form.title]);
  const { data: suggested = [] } = useQuery({
    queryKey: ['suggest-category', query],
    queryFn: () =>
      api.get<Array<{ id: string; name: string; department: { name: string } }>>(
        `/api/v1/catalog/suggest-category?title=${encodeURIComponent(query)}`,
      ),
    enabled: query.trim().length >= 3,
  });
  const department = departments.find((d) => d.categories.some((c) => c.id === form.categoryId));
  const [deptSlug, setDeptSlug] = useState(department?.slug ?? '');
  useEffect(() => {
    if (department) setDeptSlug(department.slug);
  }, [department]);
  const selectClass = 'h-10 w-full rounded-md border border-input bg-background px-3 text-sm';

  return (
    <div className="grid gap-6">
      <Field label={t('listingTitle')} description={t('listingTitleHelp')} error={errors.title}>
        <Input value={form.title} maxLength={120} onChange={(e) => set('title', e.target.value)} />
      </Field>
      {suggested.length ? (
        <fieldset className="grid gap-2">
          <legend className="mb-2 text-sm font-medium">{t('suggested')}</legend>
          {suggested.map((c) => (
            <label
              key={c.id}
              className={cn(
                'flex cursor-pointer items-center gap-3 rounded-lg border p-3 text-sm',
                form.categoryId === c.id && 'border-primary bg-accent',
              )}
            >
              <input
                type="radio"
                name="suggested"
                className="accent-primary"
                checked={form.categoryId === c.id}
                onChange={() => set('categoryId', c.id)}
              />
              <span>
                {c.name} <span className="text-muted-foreground">· {c.department.name}</span>
              </span>
            </label>
          ))}
        </fieldset>
      ) : null}
      <fieldset className="grid gap-4 sm:grid-cols-2">
        <legend className="mb-2 text-sm font-medium">{t('chooseManually')}</legend>
        <Field label={t('department')}>
          <select
            className={selectClass}
            value={deptSlug}
            onChange={(e) => setDeptSlug(e.target.value)}
          >
            <option value="">{t('choose')}</option>
            {departments.map((d) => (
              <option key={d.slug} value={d.slug}>
                {d.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label={t('category')} error={errors.categoryId}>
          <select
            className={selectClass}
            value={form.categoryId ?? ''}
            disabled={!deptSlug}
            onChange={(e) => set('categoryId', e.target.value || null)}
          >
            <option value="">{t('choose')}</option>
            {departments
              .find((d) => d.slug === deptSlug)
              ?.categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
          </select>
        </Field>
      </fieldset>
    </div>
  );
}

// ───────────── Step 2: details ─────────────

function BrandCombobox({
  value,
  onChange,
}: {
  value: WizardForm['brand'];
  onChange: (v: WizardForm['brand']) => void;
}) {
  const t = useTranslations('Sell');
  const listId = useId();
  const [text, setText] = useState(value?.name ?? '');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const { data: options = [] } = useQuery({
    queryKey: ['brands', text],
    queryFn: () => api.get<BrandOption[]>(`/api/v1/catalog/brands?q=${encodeURIComponent(text)}`),
    enabled: open && text.trim().length >= 1,
  });
  const select = (b: BrandOption) => {
    onChange({ id: b.id, name: b.name });
    setText(b.name);
    setOpen(false);
  };
  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((i) => Math.min(i + 1, options.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter' && open && options[active]) {
      e.preventDefault();
      select(options[active]);
    } else if (e.key === 'Escape') {
      setOpen(false);
    }
  };
  return (
    <div className="relative">
      <Input
        role="combobox"
        aria-expanded={open && options.length > 0}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={open && options[active] ? `${listId}-${active}` : undefined}
        placeholder={t('brandPlaceholder')}
        autoComplete="off"
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          setOpen(true);
          setActive(0);
          if (value) onChange(null);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onKeyDown={onKeyDown}
      />
      {open && text.trim() ? (
        <div
          id={listId}
          role="listbox"
          className="absolute z-20 mt-1 max-h-64 w-full overflow-auto rounded-md border bg-popover p-1 shadow-md"
        >
          {options.length === 0 ? (
            <div className="px-3 py-2 text-sm text-muted-foreground">{t('noBrand')}</div>
          ) : (
            options.map((b, i) => (
              <div
                key={b.id}
                id={`${listId}-${i}`}
                role="option"
                tabIndex={-1}
                aria-selected={i === active}
                className={cn(
                  'cursor-pointer rounded px-3 py-2 text-sm',
                  i === active && 'bg-accent',
                )}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => select(b)}
                onKeyDown={() => undefined}
              >
                {b.name}
              </div>
            ))
          )}
        </div>
      ) : null}
    </div>
  );
}

function AttributeField({
  def,
  value,
  onChange,
}: {
  def: AttributeDef;
  value: unknown;
  onChange: (v: unknown) => void;
}) {
  const t = useTranslations('Sell');
  const label = `${def.label}${def.unit ? ` (${def.unit})` : ''}`;
  if (def.type === 'BOOLEAN') {
    return (
      <label className="flex items-center gap-2 self-end pb-2 text-sm">
        <Checkbox checked={value === true} onChange={(e) => onChange(e.target.checked)} />
        {label}
      </label>
    );
  }
  if (def.type === 'ENUM') {
    return (
      <Field label={label}>
        <select
          className="h-10 rounded-md border border-input bg-background px-3 text-sm"
          value={(value as string) ?? ''}
          onChange={(e) => onChange(e.target.value || undefined)}
        >
          <option value="">{t('choose')}</option>
          {def.options?.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </Field>
    );
  }
  if (def.type === 'MULTI_ENUM') {
    const list = (value as string[] | undefined) ?? [];
    return (
      <fieldset className="grid gap-1 text-sm">
        <legend className="font-medium">{label}</legend>
        {def.options?.map((o) => (
          <label key={o.value} className="flex items-center gap-2">
            <Checkbox
              checked={list.includes(o.value)}
              onChange={(e) =>
                onChange(e.target.checked ? [...list, o.value] : list.filter((v) => v !== o.value))
              }
            />
            {o.label}
          </label>
        ))}
      </fieldset>
    );
  }
  return (
    <Field label={label}>
      <Input
        type={def.type === 'NUMBER' ? 'number' : 'text'}
        inputMode={def.type === 'NUMBER' ? 'numeric' : undefined}
        min={0}
        value={(value as string | number | undefined) ?? ''}
        onChange={(e) =>
          onChange(
            e.target.value === ''
              ? undefined
              : def.type === 'NUMBER'
                ? Number(e.target.value)
                : e.target.value,
          )
        }
      />
    </Field>
  );
}

export function DetailsStep({
  form,
  set,
  errors,
  attributes,
  needsComune,
}: StepProps & { attributes: AttributeDef[]; needsComune: boolean }) {
  const t = useTranslations('Sell');
  const tc = useTranslations('Condition');
  const th = useTranslations('ConditionHelp');
  return (
    <div className="grid gap-6">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={t('brand')}>
          <BrandCombobox value={form.brand} onChange={(b) => set('brand', b)} />
        </Field>
        <Field label={t('model')}>
          <Input
            value={form.modelName}
            maxLength={120}
            onChange={(e) => set('modelName', e.target.value)}
          />
        </Field>
        <Field label={t('year')}>
          <Input
            inputMode="numeric"
            maxLength={4}
            value={form.year}
            onChange={(e) => set('year', e.target.value.replace(/\D/g, ''))}
          />
        </Field>
      </div>
      <fieldset className="grid gap-2">
        <legend className="mb-2 text-sm font-medium">{t('condition')}</legend>
        {ITEM_CONDITIONS.map((c) => (
          <label
            key={c}
            className={cn(
              'flex cursor-pointer items-start gap-3 rounded-lg border p-3 text-sm',
              form.condition === c && 'border-primary bg-accent',
            )}
          >
            <input
              type="radio"
              name="condition"
              className="mt-1 accent-primary"
              checked={form.condition === c}
              onChange={() => set('condition', c)}
            />
            <span>
              <span className="font-medium">{tc(c)}</span>
              <span className="block text-muted-foreground">{th(c)}</span>
            </span>
          </label>
        ))}
        <p aria-live="polite" className="text-sm text-destructive empty:hidden">
          {errors.condition}
        </p>
      </fieldset>
      {attributes.length ? (
        <fieldset className="grid gap-4 sm:grid-cols-2">
          <legend className="mb-2 text-sm font-medium">{t('attributes')}</legend>
          {attributes.map((def) => (
            <AttributeField
              key={def.key}
              def={def}
              value={form.attributes[def.key]}
              onChange={(v) => set('attributes', { ...form.attributes, [def.key]: v })}
            />
          ))}
        </fieldset>
      ) : null}
      <Field
        label={t('description')}
        description={`${t('descriptionHelp')} ${t('chars', { count: form.description.length, max: 5000 })}`}
        error={errors.description}
      >
        <Textarea
          rows={8}
          maxLength={5000}
          value={form.description}
          onChange={(e) => set('description', e.target.value)}
        />
      </Field>
      {needsComune ? (
        <Field label={t('location')} description={t('locationHelp')} error={errors.comune}>
          <ComuneCombobox value={form.comune} onChange={(c) => set('comune', c)} />
        </Field>
      ) : null}
    </div>
  );
}

// ───────────── Step 4: price and delivery ─────────────

export function PriceStep({ form, set, errors, shippable }: StepProps & { shippable: boolean }) {
  const t = useTranslations('Sell');
  const tp = useTranslations('Parcel');
  return (
    <div className="grid gap-6">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={t('price')} description={t('priceHelp')} error={errors.price}>
          <Input
            inputMode="decimal"
            value={form.price}
            onChange={(e) => set('price', e.target.value)}
          />
        </Field>
      </div>
      <div className="grid gap-2 text-sm">
        <label className="flex items-center gap-2">
          <Checkbox
            checked={form.isNegotiable}
            onChange={(e) => set('isNegotiable', e.target.checked)}
          />
          {t('negotiable')}
        </label>
        <label className="flex items-center gap-2">
          <Checkbox
            checked={form.acceptsTrades}
            onChange={(e) => set('acceptsTrades', e.target.checked)}
          />
          {t('trades')}
        </label>
        <label className="flex items-start gap-2">
          <Checkbox className="mt-0.5" checked={false} disabled />
          <span>
            {t('protectedPayment')}
            <span className="block text-muted-foreground">{t('protectedPaymentHelp')}</span>
          </span>
        </label>
      </div>
      <fieldset className="grid gap-3 text-sm">
        <legend className="mb-2 font-medium">{t('delivery')}</legend>
        {!shippable ? <p className="text-muted-foreground">{t('notShippable')}</p> : null}
        {shippable ? (
          <>
            <label className="flex items-start gap-2">
              <Checkbox
                className="mt-0.5"
                checked={form.shippingIntegrated}
                onChange={(e) => set('shippingIntegrated', e.target.checked)}
              />
              <span>
                {t('shippingIntegrated')}
                <span className="block text-muted-foreground">{t('shippingIntegratedHelp')}</span>
              </span>
            </label>
            {form.shippingIntegrated ? (
              <Field label={t('parcelSize')} className="pl-6">
                <select
                  className="h-10 rounded-md border border-input bg-background px-3"
                  value={form.parcelSize ?? ''}
                  onChange={(e) =>
                    set('parcelSize', (e.target.value || null) as WizardForm['parcelSize'])
                  }
                >
                  <option value="">{t('choose')}</option>
                  {PARCEL_SIZES.map((p) => (
                    <option key={p} value={p}>
                      {tp(p)}
                    </option>
                  ))}
                </select>
              </Field>
            ) : null}
            <label className="flex items-center gap-2">
              <Checkbox
                checked={form.shippingSelf}
                onChange={(e) => set('shippingSelf', e.target.checked)}
              />
              {t('shippingSelf')}
            </label>
            {form.shippingSelf ? (
              <Field
                label={t('selfShippingPrice')}
                className="max-w-48 pl-6"
                error={errors.selfShippingPrice}
              >
                <Input
                  inputMode="decimal"
                  value={form.selfShippingPrice}
                  onChange={(e) => set('selfShippingPrice', e.target.value)}
                />
              </Field>
            ) : null}
          </>
        ) : null}
        <label className="flex items-center gap-2">
          <Checkbox
            checked={form.handDeliveryEnabled || !shippable}
            disabled={!shippable}
            onChange={(e) => set('handDeliveryEnabled', e.target.checked)}
          />
          {t('handDelivery')}
        </label>
      </fieldset>
      <Field label={t('location')} description={t('locationHelp')} error={errors.comune}>
        <ComuneCombobox value={form.comune} onChange={(c) => set('comune', c)} />
      </Field>
    </div>
  );
}
