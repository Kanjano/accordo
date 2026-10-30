'use client';
import type { ListingImageDto, UploadUrlResponse } from '@accordo/shared';
import { Alert, Button } from '@accordo/ui';
import { ArrowLeft, ArrowRight, ImagePlus, Loader2, RotateCw, Trash2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { type DragEvent, useId, useState } from 'react';
import { api } from '@/lib/api';
import { mediaSrcSet } from '@/lib/format';
import { postToStorage, prepareForUpload, UnsupportedPhotoError } from '@/lib/image-resize';
import { useErrorMessage } from '@/lib/use-error-message';

const MAX = 20;
const MAX_BYTES = 15 * 1024 * 1024;

interface Props {
  listingId: string;
  images: ListingImageDto[];
  /** Re-fetches the listing (the parent polls while images are processing). */
  onChange: () => Promise<unknown>;
}

/** SPEC §5.9 / §3.3: drag & drop, client-side resize, presigned upload with progress, reorder, rotate, delete. */
export function ImageUploader({ listingId, images, onChange }: Props) {
  const t = useTranslations('Sell');
  const errorMessage = useErrorMessage();
  const inputId = useId();
  const [uploads, setUploads] = useState<Array<{ name: string; pct: number }>>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);

  async function uploadBlob(blob: Blob, name: string) {
    setUploads((u) => [...u, { name, pct: 0 }]);
    try {
      const target = await api.post<UploadUrlResponse>('/api/v1/media/upload-url', {
        contentType: 'image/jpeg',
        size: blob.size,
      });
      await postToStorage(target.url, target.fields, blob, (pct) =>
        setUploads((u) => u.map((x) => (x.name === name ? { ...x, pct } : x))),
      );
      return await api.post<ListingImageDto>(`/api/v1/listings/${listingId}/images`, {
        key: target.key,
      });
    } finally {
      setUploads((u) => u.filter((x) => x.name !== name));
    }
  }

  async function addFiles(files: File[]) {
    setError(null);
    const room = MAX - images.length - uploads.length;
    if (files.length > room) setError(t('maxPhotos'));
    for (const file of files.slice(0, Math.max(room, 0))) {
      try {
        const blob = await prepareForUpload(file);
        if (blob.size > MAX_BYTES) throw new Error(t('tooLarge'));
        await uploadBlob(blob, `${file.name}-${crypto.randomUUID()}`);
        await onChange();
      } catch (e) {
        setError(
          e instanceof UnsupportedPhotoError
            ? t(e.reason === 'heic' ? 'heic' : 'unsupported')
            : e instanceof Error && e.message === t('tooLarge')
              ? e.message
              : errorMessage(e),
        );
      }
    }
  }

  async function run(action: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await action();
      await onChange();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  const move = (index: number, delta: number) =>
    run(() => {
      const ids = images.map((i) => i.id);
      const [moved] = ids.splice(index, 1);
      ids.splice(index + delta, 0, moved as string);
      return api.patch(`/api/v1/listings/${listingId}/images/order`, { imageIds: ids });
    });

  /** Rotation re-uploads the largest variant rotated by 90° and replaces the photo in place. */
  const rotate = (image: ListingImageDto) =>
    run(async () => {
      const source = await fetch(
        `${process.env.NEXT_PUBLIC_MEDIA_URL}/${image.key}/2048.webp`,
      ).then((r) => r.blob());
      const added = await uploadBlob(
        await prepareForUpload(new File([source], 'rotated.webp', { type: 'image/webp' }), 90),
        `rotate-${image.id}`,
      );
      await api.delete(`/api/v1/listings/${listingId}/images/${image.id}`);
      const ids = images.map((i) => (i.id === image.id ? added.id : i.id));
      await api.patch(`/api/v1/listings/${listingId}/images/order`, { imageIds: ids });
    });

  function onDrop(e: DragEvent) {
    e.preventDefault();
    setDragging(false);
    void addFiles(Array.from(e.dataTransfer.files));
  }

  return (
    <div className="grid gap-4">
      <p className="text-sm text-muted-foreground">{t('photosHelp')}</p>
      {error ? <Alert tone="error">{error}</Alert> : null}
      <label
        htmlFor={inputId}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        className={`flex cursor-pointer flex-col items-center gap-2 rounded-xl border-2 border-dashed p-8 text-center text-sm ${dragging ? 'border-primary bg-accent' : ''}`}
      >
        <ImagePlus aria-hidden className="size-8 text-primary" />
        <span className="font-medium">{t('addPhotos')}</span>
        <span className="text-muted-foreground">{t('dropHere')}</span>
        <input
          id={inputId}
          type="file"
          accept="image/jpeg,image/png,image/webp,image/heic,.heic"
          multiple
          className="sr-only"
          data-testid="photo-input"
          onChange={(e) => {
            void addFiles(Array.from(e.target.files ?? []));
            e.target.value = '';
          }}
        />
      </label>
      <div aria-live="polite" className="grid gap-1 text-sm empty:hidden">
        {uploads.map((u) => (
          <p key={u.name}>
            {t('uploading', { name: u.name.replace(/-[0-9a-f-]{36}$/, '') })} {u.pct}%
          </p>
        ))}
      </div>
      <ol className="grid grid-cols-2 gap-3 sm:grid-cols-4" data-testid="photo-list">
        {images.map((img, i) => (
          <li key={img.id} className="overflow-hidden rounded-lg border bg-card">
            <div className="relative aspect-[4/3] bg-muted">
              {img.ready ? (
                // biome-ignore lint/performance/noImgElement: variants are pre-generated on the media CDN
                <img
                  {...mediaSrcSet(img.key)}
                  sizes="200px"
                  alt={t('photoAlt', { n: i + 1 })}
                  className="size-full object-cover"
                />
              ) : (
                <span className="flex size-full items-center justify-center gap-2 text-xs text-muted-foreground">
                  <Loader2 aria-hidden className="size-4 animate-spin" />
                  {t('processing')}
                </span>
              )}
              {i === 0 ? (
                <span className="absolute top-2 left-2 rounded bg-primary px-2 py-0.5 text-xs text-primary-foreground">
                  {t('cover')}
                </span>
              ) : null}
            </div>
            <div className="flex justify-between p-1">
              <Button
                size="icon"
                variant="ghost"
                aria-label={t('moveBefore')}
                disabled={busy || i === 0}
                onClick={() => move(i, -1)}
              >
                <ArrowLeft aria-hidden />
              </Button>
              <Button
                size="icon"
                variant="ghost"
                aria-label={t('rotate')}
                disabled={busy || !img.ready}
                onClick={() => rotate(img)}
              >
                <RotateCw aria-hidden />
              </Button>
              <Button
                size="icon"
                variant="ghost"
                aria-label={t('moveAfter')}
                disabled={busy || i === images.length - 1}
                onClick={() => move(i, 1)}
              >
                <ArrowRight aria-hidden />
              </Button>
              <Button
                size="icon"
                variant="ghost"
                aria-label={t('removePhoto')}
                disabled={busy}
                onClick={() =>
                  run(() => api.delete(`/api/v1/listings/${listingId}/images/${img.id}`))
                }
              >
                <Trash2 aria-hidden />
              </Button>
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}
