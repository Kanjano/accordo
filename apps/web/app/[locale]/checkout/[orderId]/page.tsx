import { Checkout } from '@/components/orders/checkout';

export default async function Page({ params }: PageProps<'/[locale]/checkout/[orderId]'>) {
  return (
    <div className="mx-auto max-w-4xl px-4 py-8">
      <Checkout orderId={(await params).orderId} />
    </div>
  );
}
