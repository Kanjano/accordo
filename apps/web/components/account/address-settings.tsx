'use client';
import { type Address, addressInputSchema } from '@accordo/shared';
import { Alert, Button, Checkbox, Field, Input } from '@accordo/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { type FormEvent, useState } from 'react';
import { ComuneCombobox, type ComuneValue } from '@/components/comune-combobox';
import { api } from '@/lib/api';
import { useErrorMessage, useValidationMessage } from '@/lib/use-error-message';
import { SettingsSection } from './settings-section';

type Editing = { mode: 'new' } | { mode: 'edit'; address: Address } | null;

export function AddressSettings() {
  const t = useTranslations('Settings.addresses');
  const tc = useTranslations('Common');
  const errorMessage = useErrorMessage();
  const qc = useQueryClient();
  const { data: addresses } = useQuery({
    queryKey: ['addresses'],
    queryFn: () => api.get<Address[]>('/api/v1/me/addresses'),
  });
  const [editing, setEditing] = useState<Editing>(null);
  const refresh = () => qc.invalidateQueries({ queryKey: ['addresses'] });
  const remove = useMutation({
    mutationFn: (id: string) => api.delete(`/api/v1/me/addresses/${id}`),
    onSuccess: refresh,
  });

  return (
    <SettingsSection title={t('title')} description={t('intro')} as="h1">
      <div className="grid gap-4">
        {remove.isError ? <Alert tone="error">{errorMessage(remove.error)}</Alert> : null}
        {addresses?.length === 0 && !editing ? (
          <p className="text-muted-foreground">{t('empty')}</p>
        ) : null}
        <ul className="grid gap-3">
          {addresses?.map((a) => (
            <li
              key={a.id}
              className="flex flex-wrap items-start justify-between gap-3 rounded-lg border p-4"
            >
              <div className="text-sm">
                <p className="font-medium">
                  {t(`types.${a.type}`)}
                  {a.isDefault ? (
                    <span className="ml-2 rounded bg-secondary px-2 py-0.5 text-xs">
                      {t('default')}
                    </span>
                  ) : null}
                </p>
                <p>{a.fullName}</p>
                <p>
                  {a.line1}
                  {a.line2 ? `, ${a.line2}` : ''}
                </p>
                <p>
                  {a.cap} {a.comune.name} ({a.comune.provinciaSigla})
                </p>
              </div>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setEditing({ mode: 'edit', address: a })}
                >
                  {tc('edit')}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => window.confirm(t('confirmDelete')) && remove.mutate(a.id)}
                >
                  {tc('delete')}
                </Button>
              </div>
            </li>
          ))}
        </ul>
        {editing ? (
          <AddressForm
            key={editing.mode === 'edit' ? editing.address.id : 'new'}
            address={editing.mode === 'edit' ? editing.address : null}
            onDone={() => {
              setEditing(null);
              void refresh();
            }}
            onCancel={() => setEditing(null)}
          />
        ) : (
          <Button className="justify-self-start" onClick={() => setEditing({ mode: 'new' })}>
            {t('add')}
          </Button>
        )}
      </div>
    </SettingsSection>
  );
}

function AddressForm({
  address,
  onDone,
  onCancel,
}: {
  address: Address | null;
  onDone: () => void;
  onCancel: () => void;
}) {
  const t = useTranslations('Settings.addresses');
  const tc = useTranslations('Common');
  const errorMessage = useErrorMessage();
  const v = useValidationMessage();
  const [comune, setComune] = useState<ComuneValue | null>(address?.comune ?? null);
  const [errors, setErrors] = useState<Record<string, string | undefined>>({});
  const save = useMutation({
    mutationFn: (body: object) =>
      address
        ? api.patch(`/api/v1/me/addresses/${address.id}`, body)
        : api.post('/api/v1/me/addresses', body),
    onSuccess: onDone,
  });

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const parsed = addressInputSchema.safeParse({
      type: f.get('type'),
      fullName: f.get('fullName'),
      line1: f.get('line1'),
      line2: String(f.get('line2') ?? '') || null,
      cap: f.get('cap'),
      comuneId: comune?.id,
      phone: f.get('phone'),
      isDefault: f.get('isDefault') === 'on',
    });
    if (!parsed.success) {
      setErrors(
        Object.fromEntries(
          parsed.error.issues.map((i) => [
            String(i.path[0]),
            v(i.message.startsWith('Invalid') ? 'required' : i.message),
          ]),
        ),
      );
      return;
    }
    setErrors({});
    save.mutate(parsed.data);
  }

  return (
    <form onSubmit={onSubmit} className="grid gap-4 rounded-lg border p-4" noValidate>
      <h2 className="font-semibold">{address ? tc('edit') : t('new')}</h2>
      {save.isError ? <Alert tone="error">{errorMessage(save.error)}</Alert> : null}
      <Field label={t('type')}>
        <select
          name="type"
          defaultValue={address?.type ?? 'SHIPPING'}
          className="h-10 rounded-md border border-input bg-background px-3 text-sm"
        >
          <option value="SHIPPING">{t('types.SHIPPING')}</option>
          <option value="SENDER">{t('types.SENDER')}</option>
        </select>
      </Field>
      <Field label={t('fullName')} error={errors.fullName}>
        <Input name="fullName" defaultValue={address?.fullName} autoComplete="name" />
      </Field>
      <Field label={t('line1')} error={errors.line1}>
        <Input name="line1" defaultValue={address?.line1} autoComplete="address-line1" />
      </Field>
      <Field label={`${t('line2')} (${tc('optional')})`}>
        <Input name="line2" defaultValue={address?.line2 ?? ''} autoComplete="address-line2" />
      </Field>
      <div className="grid gap-4 sm:grid-cols-[8rem_1fr]">
        <Field label={t('cap')} error={errors.cap}>
          <Input
            name="cap"
            defaultValue={address?.cap}
            inputMode="numeric"
            maxLength={5}
            autoComplete="postal-code"
          />
        </Field>
        <Field label={t('comune')} error={errors.comuneId}>
          <ComuneCombobox value={comune} onChange={setComune} />
        </Field>
      </div>
      <Field label={t('phone')} description={t('phoneHelp')} error={errors.phone}>
        <Input name="phone" type="tel" defaultValue={address?.phone} autoComplete="tel" />
      </Field>
      <label className="flex items-center gap-2 text-sm">
        <Checkbox name="isDefault" defaultChecked={address?.isDefault} />
        {t('isDefault')}
      </label>
      <div className="flex gap-2">
        <Button type="submit" disabled={save.isPending}>
          {tc('save')}
        </Button>
        <Button variant="outline" onClick={onCancel}>
          {tc('cancel')}
        </Button>
      </div>
    </form>
  );
}
