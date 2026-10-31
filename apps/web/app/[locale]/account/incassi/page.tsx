import { Suspense } from 'react';
import { Payouts } from '@/components/orders/payouts';

export default function Page() {
  return (
    <Suspense>
      <Payouts />
    </Suspense>
  );
}
