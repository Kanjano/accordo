'use client';
import { useTranslations } from 'next-intl';
import { use } from 'react';
import { SellWizard } from '@/components/sell/sell-wizard';

export default function EditListingPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const t = useTranslations('Sell');
  return (
    <div className="grid gap-6">
      <h1 className="text-2xl font-bold">{t('editTitle')}</h1>
      <SellWizard listingId={id} />
    </div>
  );
}
