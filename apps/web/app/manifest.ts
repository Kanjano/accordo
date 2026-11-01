import type { MetadataRoute } from 'next';

/** Installable PWA (SPEC §12.4); push notifications come after the MVP. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Accordo — strumenti musicali usati',
    short_name: 'Accordo',
    description: 'Compra e vendi strumenti musicali usati con il pagamento protetto.',
    lang: 'it',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    background_color: '#ffffff',
    theme_color: '#8b3a25',
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
      { src: '/icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
}
