'use client';
import { useEffect } from 'react';

/** Registers the offline service worker in production builds only (no stale pages in dev). */
export function ServiceWorker() {
  useEffect(() => {
    if (process.env.NODE_ENV === 'production' && 'serviceWorker' in navigator)
      navigator.serviceWorker.register('/sw.js').catch(() => undefined);
  }, []);
  return null;
}
