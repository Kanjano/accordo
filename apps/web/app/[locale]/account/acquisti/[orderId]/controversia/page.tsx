import { OpenDispute } from '@/components/orders/dispute';

export default async function Page({
  params,
}: PageProps<'/[locale]/account/acquisti/[orderId]/controversia'>) {
  return <OpenDispute orderId={(await params).orderId} />;
}
