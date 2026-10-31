import { AccountFeedback } from '@/components/feedback/account-feedback';

export default async function Page({ searchParams }: PageProps<'/[locale]/account/feedback'>) {
  const { ordine } = await searchParams;
  return <AccountFeedback initialOrder={typeof ordine === 'string' ? ordine : undefined} />;
}
