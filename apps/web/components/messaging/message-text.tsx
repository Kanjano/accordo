'use client';
import type { MessageType } from '@accordo/shared';
import { useTranslations } from 'next-intl';

/** One-line preview of the last message (offer events are translated). */
export function useMessagePreview() {
  const t = useTranslations('Messages');
  return (m: { type: MessageType; body: string | null; senderId: string | null }, me?: string) => {
    if (m.type === 'OFFER') return t(`offerEvent.${(m.body ?? 'created') as 'created'}`);
    const text = m.body ?? '';
    return m.senderId === me ? t('you', { text }) : text;
  };
}
