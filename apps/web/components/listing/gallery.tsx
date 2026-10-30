'use client';
import type { ListingImageDto } from '@accordo/shared';
import { Button, cn } from '@accordo/ui';
import { ChevronLeft, ChevronRight, X, ZoomIn } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { type KeyboardEvent, type PointerEvent, useRef, useState } from 'react';
import { mediaSrcSet } from '@/lib/format';

/** Gallery (SPEC §3.3): swipe, keyboard arrows, thumbnails, full-screen zoom in a native dialog. */
export function Gallery({ images, title }: { images: ListingImageDto[]; title: string }) {
  const t = useTranslations('Listing');
  const [index, setIndex] = useState(0);
  const [zoomed, setZoomed] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const startX = useRef<number | null>(null);
  const ready = images.filter((i) => i.ready);
  const total = ready.length;
  if (!total)
    return (
      <div className="flex aspect-[4/3] items-center justify-center rounded-xl bg-muted text-muted-foreground">
        {t('noPhotos')}
      </div>
    );

  const current = ready[index] as ListingImageDto;
  const go = (delta: number) => setIndex((i) => (i + delta + total) % total);
  const alt = (img: ListingImageDto, i: number) =>
    img.altText || `${title} — ${t('photoCount', { n: i + 1, total })}`;
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'ArrowLeft') go(-1);
    if (e.key === 'ArrowRight') go(1);
  };
  const onPointerDown = (e: PointerEvent) => {
    startX.current = e.clientX;
  };
  const onPointerUp = (e: PointerEvent) => {
    if (startX.current === null) return;
    const dx = e.clientX - startX.current;
    startX.current = null;
    if (Math.abs(dx) > 40) go(dx < 0 ? 1 : -1);
  };

  return (
    <section aria-roledescription="carousel" aria-label={t('gallery')} className="grid gap-3">
      <div
        className="relative overflow-hidden rounded-xl bg-muted"
        onPointerDown={onPointerDown}
        onPointerUp={onPointerUp}
      >
        {/* biome-ignore lint/a11y/useSemanticElements: WAI-ARIA carousel slide pattern (role="group" + aria-roledescription) */}
        <div
          role="group"
          aria-roledescription="slide"
          aria-label={t('photoCount', { n: index + 1, total })}
          // biome-ignore lint/a11y/noNoninteractiveTabindex: focusable region for arrow-key navigation
          tabIndex={0}
          onKeyDown={onKey}
          className="aspect-[4/3] focus-visible:outline-2 focus-visible:outline-ring"
        >
          {/* biome-ignore lint/performance/noImgElement: pre-generated responsive variants */}
          <img
            {...mediaSrcSet(current.key)}
            sizes="(min-width: 1024px) 60vw, 100vw"
            alt={alt(current, index)}
            fetchPriority={index === 0 ? 'high' : 'auto'}
            className="size-full object-contain"
            style={
              current.blurDataUrl
                ? { backgroundImage: `url(${current.blurDataUrl})`, backgroundSize: 'cover' }
                : undefined
            }
            draggable={false}
          />
        </div>
        {total > 1 ? (
          <>
            <Button
              size="icon"
              variant="secondary"
              className="absolute top-1/2 left-2 -translate-y-1/2 opacity-90"
              aria-label={t('previous')}
              onClick={() => go(-1)}
            >
              <ChevronLeft aria-hidden />
            </Button>
            <Button
              size="icon"
              variant="secondary"
              className="absolute top-1/2 right-2 -translate-y-1/2 opacity-90"
              aria-label={t('nextPhoto')}
              onClick={() => go(1)}
            >
              <ChevronRight aria-hidden />
            </Button>
          </>
        ) : null}
        <Button
          size="icon"
          variant="secondary"
          className="absolute right-2 bottom-2 opacity-90"
          aria-label={t('zoom')}
          onClick={() => {
            setZoomed(true);
            dialog.current?.showModal();
          }}
        >
          <ZoomIn aria-hidden />
        </Button>
        <p
          aria-live="polite"
          className="absolute bottom-2 left-2 rounded bg-black/60 px-2 py-0.5 text-xs text-white"
        >
          {t('photoCount', { n: index + 1, total })}
        </p>
      </div>
      {total > 1 ? (
        <ul className="flex gap-2 overflow-x-auto pb-1">
          {ready.map((img, i) => (
            <li key={img.id} className="shrink-0">
              <button
                type="button"
                aria-label={t('photoCount', { n: i + 1, total })}
                aria-current={i === index ? 'true' : undefined}
                onClick={() => setIndex(i)}
                className={cn(
                  'block size-16 overflow-hidden rounded-md border-2',
                  i === index ? 'border-primary' : 'border-transparent',
                )}
              >
                {/* biome-ignore lint/performance/noImgElement: thumbnail variant */}
                <img
                  src={mediaSrcSet(img.key).src.replace('/640.webp', '/320.webp')}
                  alt=""
                  loading="lazy"
                  className="size-full object-cover"
                />
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      <dialog
        ref={dialog}
        onClose={() => setZoomed(false)}
        aria-label={t('gallery')}
        onKeyDown={onKey}
        className="m-auto max-h-none max-w-none bg-black p-0 backdrop:bg-black/90"
      >
        <div className="relative flex h-dvh w-dvw items-center justify-center">
          {/* The 2048 px variant is requested only when the zoom opens. */}
          {zoomed ? (
            // biome-ignore lint/performance/noImgElement: largest pre-generated variant
            <img
              src={mediaSrcSet(current.key).src.replace('/640.webp', '/2048.webp')}
              alt={alt(current, index)}
              className="max-h-full max-w-full object-contain"
            />
          ) : null}
          <Button
            size="icon"
            variant="secondary"
            className="absolute top-4 right-4"
            aria-label={t('closeZoom')}
            onClick={() => dialog.current?.close()}
          >
            <X aria-hidden />
          </Button>
          {total > 1 ? (
            <>
              <Button
                size="icon"
                variant="secondary"
                className="absolute top-1/2 left-4"
                aria-label={t('previous')}
                onClick={() => go(-1)}
              >
                <ChevronLeft aria-hidden />
              </Button>
              <Button
                size="icon"
                variant="secondary"
                className="absolute top-1/2 right-4"
                aria-label={t('nextPhoto')}
                onClick={() => go(1)}
              >
                <ChevronRight aria-hidden />
              </Button>
            </>
          ) : null}
        </div>
      </dialog>
    </section>
  );
}
