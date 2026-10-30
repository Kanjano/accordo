/** "1.234,56 €" (SPEC §12.2). */
export const formatPrice = (cents: number, locale = 'it-IT') =>
  new Intl.NumberFormat(locale, { style: 'currency', currency: 'EUR' }).format(cents / 100);

/** Closest pre-generated variant on the media CDN (no on-the-fly optimisation, SPEC §5.9). */
export function mediaSrcSet(key: string): { src: string; srcSet: string } {
  const base = `${process.env.NEXT_PUBLIC_MEDIA_URL}/${key}`;
  return {
    src: `${base}/640.webp`,
    srcSet: [320, 640, 1280].map((w) => `${base}/${w}.webp ${w}w`).join(', '),
  };
}
