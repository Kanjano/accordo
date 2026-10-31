'use client';
import {
  DISPUTE_REASONS,
  type DisputeDetail,
  type DisputeReasonCode,
  SELLER_RESPONSES,
  type UploadUrlResponse,
} from '@accordo/shared';
import { Alert, Button, Input, Label, Textarea } from '@accordo/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useFormatter, useTranslations } from 'next-intl';
import { type FormEvent, useId, useState } from 'react';
import { useRouter } from '@/i18n/navigation';
import { api } from '@/lib/api';
import { formatPrice } from '@/lib/format';
import { postToStorage, prepareForUpload } from '@/lib/image-resize';
import { parseEuroToCents } from '@/lib/price';
import { useErrorMessage } from '@/lib/use-error-message';

const API = process.env.NEXT_PUBLIC_API_URL ?? '';
const PHOTO_REASONS: DisputeReasonCode[] = [
  'NOT_AS_DESCRIBED',
  'DAMAGED',
  'INCOMPLETE',
  'COUNTERFEIT',
];

/** Photos for the dispute: resized in the browser, uploaded with a presigned POST (private bucket). */
function useEvidenceUpload() {
  const [keys, setKeys] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  async function add(files: File[]) {
    setBusy(true);
    try {
      for (const file of files.slice(0, 10 - keys.length)) {
        const blob = await prepareForUpload(file);
        const target = await api.post<UploadUrlResponse>('/api/v1/media/upload-url', {
          contentType: 'image/jpeg',
          size: blob.size,
        });
        await postToStorage(target.url, target.fields, blob, () => undefined);
        setKeys((k) => [...k, target.key]);
      }
    } finally {
      setBusy(false);
    }
  }
  return { keys, busy, add, reset: () => setKeys([]) };
}

function PhotoInput({
  upload,
  label,
}: {
  upload: ReturnType<typeof useEvidenceUpload>;
  label: string;
}) {
  const t = useTranslations('Disputes');
  const id = useId();
  return (
    <div className="grid gap-1">
      <Label htmlFor={id}>{label}</Label>
      <input
        id={id}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/heic,.heic"
        multiple
        data-testid="evidence-input"
        disabled={upload.busy}
        onChange={(e) => {
          void upload.add(Array.from(e.target.files ?? []));
          e.target.value = '';
        }}
        className="text-sm"
      />
      <p className="text-xs text-muted-foreground" aria-live="polite">
        {upload.busy ? t('uploading') : t('photos', { count: upload.keys.length })}
      </p>
    </div>
  );
}

/** "Apri una controversia" (SPEC §6.6). */
export function OpenDispute({ orderId }: { orderId: string }) {
  const t = useTranslations('Disputes');
  const errorMessage = useErrorMessage();
  const router = useRouter();
  const qc = useQueryClient();
  const id = useId();
  const upload = useEvidenceUpload();
  const [reason, setReason] = useState<DisputeReasonCode>('NOT_AS_DESCRIBED');
  const [description, setDescription] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const needsPhotos = PHOTO_REASONS.includes(reason);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.request(`/api/v1/orders/${orderId}/dispute`, {
        method: 'POST',
        headers: { 'idempotency-key': crypto.randomUUID() },
        json: { reason, description, evidenceKeys: upload.keys },
      });
      await qc.invalidateQueries({ queryKey: ['order', orderId] });
      router.push(`/account/acquisti/${orderId}`);
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="grid max-w-2xl gap-4">
      <h1 className="text-2xl font-bold">{t('openTitle')}</h1>
      <p className="text-sm text-muted-foreground">{t('openIntro')}</p>
      <div className="grid gap-1">
        <Label htmlFor={`${id}-reason`}>{t('reasonLabel')}</Label>
        <select
          id={`${id}-reason`}
          value={reason}
          onChange={(e) => setReason(e.target.value as DisputeReasonCode)}
          className="h-10 rounded-md border bg-background px-3"
        >
          {DISPUTE_REASONS.map((r) => (
            <option key={r} value={r}>
              {t(`reason.${r}`)}
            </option>
          ))}
        </select>
      </div>
      <div className="grid gap-1">
        <Label htmlFor={`${id}-desc`}>{t('description')}</Label>
        <Textarea
          id={`${id}-desc`}
          rows={5}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          aria-describedby={`${id}-desc-hint`}
        />
        <p id={`${id}-desc-hint`} className="text-xs text-muted-foreground">
          {t('descriptionHint', { count: description.trim().length })}
        </p>
      </div>
      <PhotoInput upload={upload} label={needsPhotos ? t('photosRequired') : t('photosOptional')} />
      {error ? <Alert tone="error">{error}</Alert> : null}
      <Button
        type="submit"
        className="justify-self-start"
        disabled={
          busy ||
          upload.busy ||
          description.trim().length < 30 ||
          (needsPhotos && upload.keys.length < 2)
        }
      >
        {t('submit')}
      </Button>
    </form>
  );
}

/** Dispute thread and actions inside the order page, for both parties (and the staff). */
export function DisputePanel({ disputeId, admin = false }: { disputeId: string; admin?: boolean }) {
  const t = useTranslations('Disputes');
  const format = useFormatter();
  const qc = useQueryClient();
  const errorMessage = useErrorMessage();
  const upload = useEvidenceUpload();
  const id = useId();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const key = ['dispute', disputeId];
  const { data: d } = useQuery({
    queryKey: key,
    queryFn: () => api.get<DisputeDetail>(`/api/v1/${admin ? 'admin/' : ''}disputes/${disputeId}`),
    refetchInterval: 15_000,
  });
  const date = (iso: string | null) =>
    iso ? format.dateTime(new Date(iso), { dateStyle: 'medium', timeStyle: 'short' }) : '';

  async function run(action: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      const updated = await action();
      if (updated && typeof updated === 'object' && 'status' in updated)
        qc.setQueryData(key, updated);
      else await qc.invalidateQueries({ queryKey: key });
      void qc.invalidateQueries({ queryKey: ['order'] });
      return true;
    } catch (e) {
      setError(errorMessage(e));
      return false;
    } finally {
      setBusy(false);
    }
  }
  const post = (path: string, body: object = {}) =>
    api.post<DisputeDetail>(`/api/v1/disputes/${disputeId}/${path}`, body);

  if (!d) return null;
  const can = (a: DisputeDetail['actions'][number]) => d.actions.includes(a);
  return (
    <section
      aria-labelledby={`${id}-title`}
      className="grid gap-4 rounded-xl border border-amber-500/50 p-4"
    >
      <h2 id={`${id}-title`} className="font-semibold">
        {t('title')} · {t(`status.${d.status}`)}
      </h2>
      <p className="text-sm">
        <strong>{t(`reason.${d.reason}`)}</strong> — {d.description}
      </p>
      {d.status === 'OPEN' && d.sellerResponseDueAt ? (
        <p className="text-sm">{t('sellerDue', { date: date(d.sellerResponseDueAt) })}</p>
      ) : null}
      {d.status === 'AWAITING_BUYER' && d.proposedRefundCents ? (
        <Alert>
          {t('proposal', { amount: formatPrice(d.proposedRefundCents) })}{' '}
          {d.buyerResponseDueAt ? t('buyerDue', { date: date(d.buyerResponseDueAt) }) : ''}
        </Alert>
      ) : null}
      {d.outcome && (d.status === 'RESOLVED' || d.status === 'AWAITING_RETURN') ? (
        <Alert tone={d.status === 'RESOLVED' ? 'success' : 'info'}>
          {t(`outcome.${d.outcome}`)}
          {d.resolvedRefundCents ? ` · ${formatPrice(d.resolvedRefundCents)}` : ''}
          {d.resolutionNotes ? (
            <span className="mt-1 block">
              <strong>{t('motivation')}</strong> {d.resolutionNotes}
            </span>
          ) : null}
        </Alert>
      ) : null}
      {d.appealedAt ? (
        <p className="text-sm">
          {d.appealResolvedAt
            ? `${t(d.appealUpheld ? 'appealUpheld' : 'appealOverturned')} ${d.appealNotes ?? ''}`
            : t('appealPending')}
        </p>
      ) : null}

      {d.evidence.length ? (
        <ul className="flex flex-wrap gap-2" aria-label={t('evidence')}>
          {d.evidence.map((e, i) => (
            <li key={e.id}>
              <a
                href={`${API}/api/v1/disputes/${d.id}/evidence/${e.id}`}
                target="_blank"
                rel="noopener noreferrer"
              >
                {/* biome-ignore lint/performance/noImgElement: private evidence served by the API */}
                <img
                  src={`${API}/api/v1/disputes/${d.id}/evidence/${e.id}`}
                  alt={t('evidenceAlt', { n: i + 1, who: t(`role.${e.uploadedByRole}`) })}
                  className="size-24 rounded-md object-cover"
                />
              </a>
            </li>
          ))}
        </ul>
      ) : null}

      {d.messages.length ? (
        <ol className="grid gap-2 text-sm" aria-label={t('thread')}>
          {d.messages.map((m) => (
            <li key={m.id} className="rounded-lg bg-muted p-2">
              <span className="text-xs text-muted-foreground">
                {t(`role.${m.authorRole as 'BUYER'}`)} · {date(m.createdAt)}
              </span>
              <p className="whitespace-pre-wrap">{m.body}</p>
            </li>
          ))}
        </ol>
      ) : null}
      {error ? <Alert tone="error">{error}</Alert> : null}

      {can('respond') ? (
        <RespondForm
          itemPriceCents={d.itemPriceCents}
          busy={busy}
          onSubmit={(body) => run(() => post('respond', body))}
        />
      ) : null}
      <div className="flex flex-wrap gap-2">
        {can('acceptProposal') ? (
          <Button disabled={busy} onClick={() => run(() => post('accept-proposal'))}>
            {t('acceptProposal')}
          </Button>
        ) : null}
        {can('escalate') ? (
          <Button variant="outline" disabled={busy} onClick={() => run(() => post('escalate'))}>
            {t('escalate')}
          </Button>
        ) : null}
        {can('withdraw') ? (
          <Button
            variant="ghost"
            disabled={busy}
            onClick={() => window.confirm(t('withdrawConfirm')) && run(() => post('withdraw'))}
          >
            {t('withdraw')}
          </Button>
        ) : null}
        {can('appeal') ? (
          <Button variant="outline" disabled={busy} onClick={() => run(() => post('appeal'))}>
            {t('appeal')}
          </Button>
        ) : null}
      </div>

      {can('message') ? (
        <form
          className="grid gap-2"
          onSubmit={async (e) => {
            e.preventDefault();
            const path = admin
              ? `/api/v1/admin/disputes/${disputeId}/request-evidence`
              : `/api/v1/disputes/${disputeId}/messages`;
            if (await run(() => api.post(path, { body: message }))) setMessage('');
          }}
        >
          <Label htmlFor={`${id}-msg`}>{admin ? t('askEvidence') : t('writeMessage')}</Label>
          <Textarea
            id={`${id}-msg`}
            rows={2}
            value={message}
            onChange={(e) => setMessage(e.target.value)}
          />
          <Button
            type="submit"
            size="sm"
            variant="secondary"
            className="justify-self-start"
            disabled={busy || !message.trim()}
          >
            {t('send')}
          </Button>
        </form>
      ) : null}
      {can('addEvidence') && !admin ? (
        <div className="grid gap-2">
          <PhotoInput upload={upload} label={t('addEvidence')} />
          {upload.keys.length ? (
            <Button
              size="sm"
              className="justify-self-start"
              disabled={busy || upload.busy}
              onClick={async () => {
                if (await run(() => post('evidence', { evidenceKeys: upload.keys })))
                  upload.reset();
              }}
            >
              {t('sendEvidence')}
            </Button>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

function RespondForm({
  itemPriceCents,
  busy,
  onSubmit,
}: {
  itemPriceCents: number;
  busy: boolean;
  onSubmit: (b: { action: string; amountCents?: number; message: string }) => void;
}) {
  const t = useTranslations('Disputes');
  const id = useId();
  const [action, setAction] = useState<(typeof SELLER_RESPONSES)[number]>('PROPOSE_PARTIAL');
  const [amount, setAmount] = useState('');
  const [message, setMessage] = useState('');
  const cents = parseEuroToCents(amount);
  const partial = action === 'PROPOSE_PARTIAL';
  return (
    <form
      className="grid gap-2 rounded-lg bg-muted p-3"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit({ action, message, ...(partial && cents ? { amountCents: cents } : {}) });
      }}
    >
      <fieldset className="grid gap-1 text-sm">
        <legend className="mb-1 font-medium">{t('respondTitle')}</legend>
        {SELLER_RESPONSES.map((r) => (
          <label key={r} className="flex items-center gap-2">
            <input
              type="radio"
              name={`${id}-action`}
              className="size-4 accent-primary"
              checked={action === r}
              onChange={() => setAction(r)}
            />
            {t(`respond.${r}`)}
          </label>
        ))}
      </fieldset>
      {partial ? (
        <div className="grid gap-1">
          <Label htmlFor={`${id}-amount`}>
            {t('amount', { max: formatPrice(itemPriceCents) })}
          </Label>
          <Input
            id={`${id}-amount`}
            inputMode="decimal"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            className="max-w-40"
          />
        </div>
      ) : null}
      <div className="grid gap-1">
        <Label htmlFor={`${id}-message`}>{t('respondMessage')}</Label>
        <Textarea
          id={`${id}-message`}
          rows={2}
          value={message}
          onChange={(e) => setMessage(e.target.value)}
        />
      </div>
      <Button
        type="submit"
        size="sm"
        className="justify-self-start"
        disabled={busy || !message.trim() || (partial && (!cents || cents > itemPriceCents))}
      >
        {t('sendResponse')}
      </Button>
    </form>
  );
}
