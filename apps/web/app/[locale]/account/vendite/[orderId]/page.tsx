import { OrderView } from '@/components/orders/order-view';

export default async function Page({ params }: PageProps<'/[locale]/account/vendite/[orderId]'>) {
  return <OrderView id={(await params).orderId} />;
}
