'use client';
import { Button } from '@accordo/ui';
import { Share2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';

export function ShareButton({ title }: { title: string }) {
  const t = useTranslations('Listing');
  const [copied, setCopied] = useState(false);
  async function share() {
    const url = window.location.href;
    if (navigator.share) {
      await navigator.share({ title, url }).catch(() => undefined);
    } else {
      await navigator.clipboard.writeText(url);
      setCopied(true);
    }
  }
  return (
    <Button variant="outline" onClick={share}>
      <Share2 aria-hidden />
      <span aria-live="polite">{copied ? t('copied') : t('share')}</span>
    </Button>
  );
}
