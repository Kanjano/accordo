'use client';
import { useEffect } from 'react';
import { analyticsAllowed, CONSENT_CHANGED_EVENT } from '@/lib/consent';

/** Loads the privacy-friendly analytics script only after explicit consent (SPEC §12.4, §14.5). */
export function Analytics() {
  useEffect(() => {
    const src = process.env.NEXT_PUBLIC_ANALYTICS_SRC;
    if (!src) return;
    const sync = () => {
      const existing = document.querySelector('script[data-analytics]');
      if (analyticsAllowed(document.cookie)) {
        if (existing) return;
        const s = document.createElement('script');
        s.src = src;
        s.defer = true;
        s.dataset.analytics = 'true';
        if (process.env.NEXT_PUBLIC_ANALYTICS_DOMAIN)
          s.dataset.domain = process.env.NEXT_PUBLIC_ANALYTICS_DOMAIN;
        document.head.appendChild(s);
      } else {
        existing?.remove();
      }
    };
    sync();
    window.addEventListener(CONSENT_CHANGED_EVENT, sync);
    return () => window.removeEventListener(CONSENT_CHANGED_EVENT, sync);
  }, []);
  return null;
}
