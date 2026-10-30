import { notFound } from 'next/navigation';
import { Thread } from '@/components/messaging/thread';

export default async function ConversationPage({ params }: PageProps<'/[locale]/messaggi/[id]'>) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  return (
    <div className="mx-auto max-w-3xl px-4 py-6">
      <Thread id={id} />
    </div>
  );
}
