'use client';
import type {
  AdminAuditItem,
  AdminCatalog,
  AdminDac7Row,
  AdminDashboard,
  AdminWebhookItem,
} from '@accordo/shared';
import { Alert, Button, Input, Label, Textarea } from '@accordo/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useFormatter, useTranslations } from 'next-intl';
import { useId, useState } from 'react';
import { useStepUp } from '@/components/step-up';
import { Link } from '@/i18n/navigation';
import { ApiError, api } from '@/lib/api';
import { formatPrice } from '@/lib/format';
import { useErrorMessage } from '@/lib/use-error-message';
import { Tabs } from './moderation';

const when = (format: ReturnType<typeof useFormatter>, iso: string | null) =>
  iso ? format.dateTime(new Date(iso), { dateStyle: 'short', timeStyle: 'short' }) : '—';

function QueryError({ error }: { error: unknown }) {
  const errorMessage = useErrorMessage();
  return error ? <Alert tone="error">{errorMessage(error)}</Alert> : null;
}

// ───────────── Dashboard ─────────────

export function AdminDashboardView() {
  const t = useTranslations('Admin');
  const ts = useTranslations('OrderStatus');
  const format = useFormatter();
  const { data: d, error } = useQuery({
    queryKey: ['admin-dashboard'],
    queryFn: () => api.get<AdminDashboard>('/api/v1/admin/dashboard'),
  });
  const backlog: Array<[keyof AdminDashboard['backlog'], string]> = [
    ['reports', '/admin/segnalazioni'],
    ['listings', '/admin/annunci'],
    ['appeals', '/admin/ricorsi'],
    ['shops', '/admin/negozi'],
    ['disputes', '/admin/controversie'],
    ['feedback', '/admin/feedback'],
    ['webhooksFailed', '/admin/webhook'],
  ];
  return (
    <div className="grid gap-6">
      <h1 className="text-2xl font-bold">{t('sections.dashboard')}</h1>
      <QueryError error={error} />
      {d ? (
        <>
          <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {[
              [t('kpi.gmv'), formatPrice(d.gmv30dCents)],
              [t('kpi.orders'), String(d.orders30d)],
              [
                t('kpi.disputeRate'),
                format.number(d.disputeRateBps / 10_000, {
                  style: 'percent',
                  maximumFractionDigits: 1,
                }),
              ],
              [
                t('kpi.shipTime'),
                d.avgShipHours === null ? '—' : t('hours', { count: d.avgShipHours }),
              ],
            ].map(([k, v]) => (
              <div key={k} className="rounded-xl border p-4">
                <dt className="text-sm text-muted-foreground">{k}</dt>
                <dd className="text-2xl font-bold">{v}</dd>
              </div>
            ))}
          </dl>
          <section className="grid gap-2">
            <h2 className="text-lg font-semibold">{t('backlog')}</h2>
            <ul className="flex flex-wrap gap-2 text-sm">
              {backlog.map(([k, href]) => (
                <li key={k}>
                  <Link href={href} className="block rounded-lg border px-3 py-2 hover:bg-accent">
                    {t(`backlogItems.${k}`)}: <strong>{d.backlog[k]}</strong>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
          <section className="grid gap-2">
            <h2 className="text-lg font-semibold">{t('ordersByStatus')}</h2>
            <ul className="flex flex-wrap gap-2 text-sm">
              {Object.entries(d.ordersByStatus).map(([s, n]) => (
                <li key={s} className="rounded-lg bg-muted px-3 py-1">
                  {ts(s as 'PAID')}: {n}
                </li>
              ))}
            </ul>
          </section>
          <section className="grid gap-2 text-sm">
            <h2 className="text-lg font-semibold">{t('dsaTitle')}</h2>
            <p>
              {t('dsaStats', {
                reports: d.dsa.reports,
                actions: d.dsa.actions,
                automated: d.dsa.automatedActions,
                appeals: d.dsa.appeals,
                reversed: d.dsa.reversed,
                hours: d.dsa.medianDecisionHours ?? 0,
              })}
            </p>
          </section>
        </>
      ) : null}
    </div>
  );
}

// ───────────── Settings ─────────────

export function AdminSettings() {
  const t = useTranslations('Admin');
  const { data, error } = useQuery({
    queryKey: ['admin-settings'],
    queryFn: () =>
      api.get<Array<{ key: string; value: unknown; updatedAt: string }>>('/api/v1/admin/settings'),
  });
  return (
    <div className="grid gap-4">
      <h1 className="text-2xl font-bold">{t('sections.settings')}</h1>
      <p className="text-sm text-muted-foreground">{t('settingsIntro')}</p>
      <QueryError error={error} />
      <ul className="grid gap-4">
        {data?.map((s) => (
          <li key={s.key}>
            <SettingEditor setting={s} />
          </li>
        ))}
      </ul>
    </div>
  );
}

function SettingEditor({
  setting,
}: {
  setting: { key: string; value: unknown; updatedAt: string };
}) {
  const t = useTranslations('Admin');
  const format = useFormatter();
  const id = useId();
  const qc = useQueryClient();
  const withStepUp = useStepUp();
  const errorMessage = useErrorMessage();
  const [text, setText] = useState(JSON.stringify(setting.value, null, 2));
  const [msg, setMsg] = useState<{ tone: 'error' | 'success'; text: string } | null>(null);
  async function save() {
    let value: unknown;
    try {
      value = JSON.parse(text);
    } catch {
      return setMsg({ tone: 'error', text: t('invalidJson') });
    }
    try {
      await withStepUp(() => api.put(`/api/v1/admin/settings/${setting.key}`, { value }));
      await qc.invalidateQueries({ queryKey: ['admin-settings'] });
      setMsg({ tone: 'success', text: t('saved') });
    } catch (e) {
      setMsg({ tone: 'error', text: errorMessage(e) });
    }
  }
  return (
    <div className="grid gap-2 rounded-xl border p-4">
      <Label htmlFor={id} className="font-mono">
        {setting.key}{' '}
        <span className="font-sans text-xs text-muted-foreground">
          {when(format, setting.updatedAt)}
        </span>
      </Label>
      <Textarea
        id={id}
        rows={Math.min(14, text.split('\n').length)}
        className="font-mono text-xs"
        value={text}
        onChange={(e) => setText(e.target.value)}
      />
      {msg ? <Alert tone={msg.tone}>{msg.text}</Alert> : null}
      <Button size="sm" className="justify-self-start" onClick={save}>
        {t('save')}
      </Button>
    </div>
  );
}

// ───────────── Catalog ─────────────

type Entity = 'departments' | 'categories' | 'attributes' | 'brands';
const EDITABLE: Record<Entity, string[]> = {
  departments: ['slug', 'name', 'position', 'icon'],
  categories: [
    'departmentId',
    'parentId',
    'slug',
    'name',
    'position',
    'isActive',
    'shippable',
    'defaultParcelSize',
  ],
  attributes: ['key', 'label', 'type', 'unit', 'options', 'isFilterable'],
  brands: ['name', 'slug', 'aliases', 'isVerified'],
};
const pick = (row: Record<string, unknown>, keys: string[]) =>
  Object.fromEntries(keys.map((k) => [k, row[k] ?? null]));

export function AdminCatalogView() {
  const t = useTranslations('Admin');
  const [tab, setTab] = useState<Entity>('departments');
  const [brandQ, setBrandQ] = useState('');
  const { data: catalog, error } = useQuery({
    queryKey: ['admin-catalog'],
    queryFn: () => api.get<AdminCatalog>('/api/v1/admin/catalog'),
  });
  const { data: brands } = useQuery({
    queryKey: ['admin-brands', brandQ],
    queryFn: () =>
      api.get<Array<Record<string, unknown> & { id: string; name: string }>>(
        `/api/v1/admin/catalog/brands?q=${encodeURIComponent(brandQ)}`,
      ),
    enabled: tab === 'brands',
  });
  const rows: Array<Record<string, unknown> & { id: string }> =
    tab === 'brands'
      ? (brands ?? [])
      : ((catalog?.[tab] ?? []) as Array<Record<string, unknown> & { id: string }>);
  return (
    <div className="grid gap-4">
      <h1 className="text-2xl font-bold">{t('sections.catalog')}</h1>
      <p className="text-sm text-muted-foreground">{t('catalogIntro')}</p>
      <QueryError error={error} />
      <Tabs
        value={tab}
        label={t('sections.catalog')}
        onChange={setTab}
        options={(['departments', 'categories', 'attributes', 'brands'] as const).map((e) => [
          e,
          t(`catalog.${e}`),
        ])}
      />
      {tab === 'brands' ? (
        <Input
          aria-label={t('search')}
          placeholder={t('search')}
          value={brandQ}
          onChange={(e) => setBrandQ(e.target.value)}
        />
      ) : null}
      <CatalogRow key={`${tab}-new`} entity={tab} row={null} />
      <ul className="grid gap-2">
        {rows.map((r) => (
          <li key={r.id}>
            <CatalogRow entity={tab} row={r} />
          </li>
        ))}
      </ul>
    </div>
  );
}

function CatalogRow({
  entity,
  row,
}: {
  entity: Entity;
  row: (Record<string, unknown> & { id: string }) | null;
}) {
  const t = useTranslations('Admin');
  const id = useId();
  const qc = useQueryClient();
  const errorMessage = useErrorMessage();
  const [open, setOpen] = useState(false);
  const blank = Object.fromEntries(EDITABLE[entity].map((k) => [k, null]));
  const [text, setText] = useState(
    JSON.stringify(row ? pick(row, EDITABLE[entity]) : blank, null, 2),
  );
  const [attrs, setAttrs] = useState(JSON.stringify(row?.attributes ?? [], null, 2));
  const [msg, setMsg] = useState<string | null>(null);
  const clean = (o: Record<string, unknown>) =>
    Object.fromEntries(Object.entries(o).filter(([, v]) => v !== null));
  async function save() {
    setMsg(null);
    try {
      const body = clean(JSON.parse(text));
      const path = `/api/v1/admin/catalog/${entity}`;
      if (row) await api.patch(`${path}/${row.id}`, body);
      else await api.post(path, body);
      if (row && entity === 'categories')
        await api.put(`${path}/${row.id}/attributes`, { attributes: JSON.parse(attrs) });
      await qc.invalidateQueries({ queryKey: ['admin-catalog'] });
      await qc.invalidateQueries({ queryKey: ['admin-brands'] });
      setOpen(false);
    } catch (e) {
      setMsg(e instanceof SyntaxError ? t('invalidJson') : errorMessage(e));
    }
  }
  const title = row ? String(row.name ?? row.label ?? row.key ?? row.id) : t('new');
  return (
    <div className="rounded-lg border p-3 text-sm">
      <button
        type="button"
        className="font-medium underline-offset-4 hover:underline"
        onClick={() => setOpen((o) => !o)}
      >
        {title}
        {row?.slug ? <span className="text-muted-foreground"> · {String(row.slug)}</span> : null}
      </button>
      {open ? (
        <div className="mt-2 grid gap-2">
          <Label htmlFor={id}>{t('fieldsJson')}</Label>
          <Textarea
            id={id}
            rows={8}
            className="font-mono text-xs"
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
          {row && entity === 'categories' ? (
            <>
              <Label htmlFor={`${id}-a`}>{t('categoryAttributes')}</Label>
              <Textarea
                id={`${id}-a`}
                rows={4}
                className="font-mono text-xs"
                value={attrs}
                onChange={(e) => setAttrs(e.target.value)}
              />
            </>
          ) : null}
          {msg ? <Alert tone="error">{msg}</Alert> : null}
          <Button size="sm" className="justify-self-start" onClick={save}>
            {t('save')}
          </Button>
        </div>
      ) : null}
    </div>
  );
}

// ───────────── Audit ─────────────

export function AdminAudit() {
  const t = useTranslations('Admin');
  const format = useFormatter();
  const [filter, setFilter] = useState({ actorId: '', entityType: '', entityId: '' });
  const [applied, setApplied] = useState(filter);
  const qs = new URLSearchParams(Object.entries(applied).filter(([, v]) => v)).toString();
  const { data, error } = useQuery({
    queryKey: ['admin-audit', qs],
    queryFn: () => api.get<AdminAuditItem[]>(`/api/v1/admin/audit?${qs}`),
  });
  return (
    <div className="grid gap-4">
      <h1 className="text-2xl font-bold">{t('sections.audit')}</h1>
      <form
        className="flex flex-wrap items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          setApplied(filter);
        }}
      >
        {(['actorId', 'entityType', 'entityId'] as const).map((k) => (
          <label key={k} className="grid gap-1 text-sm">
            {t(`auditFilter.${k}`)}
            <Input
              value={filter[k]}
              onChange={(e) => setFilter({ ...filter, [k]: e.target.value })}
            />
          </label>
        ))}
        <Button type="submit">{t('search')}</Button>
      </form>
      <QueryError error={error} />
      <div className="overflow-x-auto">
        <table className="w-full text-left text-xs">
          <thead>
            <tr className="border-b">
              <th className="p-2">{t('auditCols.when')}</th>
              <th className="p-2">{t('auditCols.action')}</th>
              <th className="p-2">{t('auditCols.entity')}</th>
              <th className="p-2">{t('auditCols.actor')}</th>
              <th className="p-2">{t('auditCols.details')}</th>
            </tr>
          </thead>
          <tbody>
            {data?.map((a) => (
              <tr key={a.id} className="border-b align-top">
                <td className="p-2 whitespace-nowrap">{when(format, a.createdAt)}</td>
                <td className="p-2 font-mono">{a.action}</td>
                <td className="p-2 font-mono">
                  {a.entityType} {a.entityId}
                </td>
                <td className="p-2 font-mono">{a.actorId ?? '—'}</td>
                <td className="max-w-80 break-all p-2 font-mono">
                  {a.metadata ? JSON.stringify(a.metadata) : ''}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ───────────── Webhooks ─────────────

export function AdminWebhooks() {
  const t = useTranslations('Admin');
  const format = useFormatter();
  const qc = useQueryClient();
  const errorMessage = useErrorMessage();
  const [status, setStatus] = useState<'failed' | 'pending' | 'processed'>('failed');
  const [msg, setMsg] = useState<string | null>(null);
  const { data, error } = useQuery({
    queryKey: ['admin-webhooks', status],
    queryFn: () => api.get<AdminWebhookItem[]>(`/api/v1/admin/webhooks?status=${status}`),
  });
  async function replay(w: AdminWebhookItem) {
    setMsg(null);
    try {
      await api.post(
        `/api/v1/admin/webhooks/${encodeURIComponent(w.provider)}/${encodeURIComponent(w.eventId)}/replay`,
      );
      setMsg(t('replayed'));
      await qc.invalidateQueries({ queryKey: ['admin-webhooks'] });
    } catch (e) {
      setMsg(errorMessage(e));
    }
  }
  return (
    <div className="grid gap-4">
      <h1 className="text-2xl font-bold">{t('sections.webhooks')}</h1>
      <Tabs
        value={status}
        label={t('sections.webhooks')}
        onChange={setStatus}
        options={(['failed', 'pending', 'processed'] as const).map((s) => [
          s,
          t(`webhookTabs.${s}`),
        ])}
      />
      <QueryError error={error} />
      {msg ? <p role="status">{msg}</p> : null}
      {data && !data.length ? <p className="text-muted-foreground">{t('empty')}</p> : null}
      <ul className="grid gap-2 text-sm">
        {data?.map((w) => (
          <li key={`${w.provider}/${w.eventId}`} className="grid gap-1 rounded-lg border p-3">
            <p className="font-mono">
              {w.provider} · {w.type} · {w.eventId.slice(0, 24)}
            </p>
            <p className="text-muted-foreground">
              {when(format, w.receivedAt)} · {t('attempts', { count: w.attempts })}
              {w.processedAt ? ` · ${when(format, w.processedAt)}` : ''}
            </p>
            {w.lastError ? (
              <p className="break-all font-mono text-xs text-destructive">{w.lastError}</p>
            ) : null}
            {w.processedAt ? null : (
              <Button
                size="sm"
                variant="outline"
                className="justify-self-start"
                onClick={() => replay(w)}
              >
                {t('replay')}
              </Button>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

// ───────────── DAC7 ─────────────

export function AdminDac7() {
  const t = useTranslations('Admin');
  const format = useFormatter();
  const withStepUp = useStepUp();
  const errorMessage = useErrorMessage();
  const [year, setYear] = useState(new Date().getFullYear());
  const [msg, setMsg] = useState<string | null>(null);
  const { data, error } = useQuery({
    queryKey: ['admin-dac7', year],
    queryFn: () => api.get<AdminDac7Row[]>(`/api/v1/admin/dac7?year=${year}`),
  });
  async function download() {
    setMsg(null);
    try {
      const res = await withStepUp(async () => {
        const r = await fetch(
          `${process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000'}/api/v1/admin/dac7/export?year=${year}`,
          { credentials: 'include' },
        );
        if (!r.ok) throw new ApiError(await r.json().catch(() => ({})), r.status);
        return r.blob();
      });
      const url = URL.createObjectURL(res);
      const a = document.createElement('a');
      a.href = url;
      a.download = `dac7-${year}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setMsg(errorMessage(e));
    }
  }
  async function remind(userId: string) {
    setMsg(null);
    try {
      await api.post(`/api/v1/admin/dac7/${userId}/remind`);
      setMsg(t('reminderSent'));
    } catch (e) {
      setMsg(errorMessage(e));
    }
  }
  return (
    <div className="grid gap-4">
      <h1 className="text-2xl font-bold">{t('sections.dac7')}</h1>
      <p className="text-sm text-muted-foreground">{t('dac7Intro')}</p>
      <div className="flex flex-wrap items-end gap-2">
        <label className="grid gap-1 text-sm">
          {t('year')}
          <Input
            type="number"
            value={year}
            onChange={(e) => setYear(Number(e.target.value))}
            className="w-28"
          />
        </label>
        <Button variant="outline" onClick={download}>
          {t('exportCsv')}
        </Button>
      </div>
      <QueryError error={error} />
      {msg ? <p role="status">{msg}</p> : null}
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b">
              <th className="p-2">{t('dac7Cols.seller')}</th>
              <th className="p-2">{t('dac7Cols.activities')}</th>
              <th className="p-2">{t('dac7Cols.consideration')}</th>
              <th className="p-2">{t('dac7Cols.state')}</th>
              <th className="p-2">{t('dac7Cols.reminders')}</th>
              <th className="p-2" />
            </tr>
          </thead>
          <tbody>
            {data?.map((r) => (
              <tr key={r.userId} className="border-b">
                <td className="p-2">{r.email}</td>
                <td className="p-2">{r.activities}</td>
                <td className="p-2">{formatPrice(r.considerationCents)}</td>
                <td className="p-2">
                  {r.reportable ? t('reportable') : t('nearThreshold')} ·{' '}
                  {r.hasProfile ? t('profileOk') : t('profileMissing')}
                </td>
                <td className="p-2">
                  {r.remindersSent}
                  {r.lastReminderAt ? ` (${when(format, r.lastReminderAt)})` : ''}
                </td>
                <td className="p-2">
                  {r.hasProfile ? null : (
                    <Button size="sm" variant="outline" onClick={() => remind(r.userId)}>
                      {t('remind')}
                    </Button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
