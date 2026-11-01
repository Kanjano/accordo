'use client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { type ReactNode, useState } from 'react';
import { RealtimeProvider } from '@/lib/realtime';
import { useSessionSync } from '@/lib/session';
import { StepUpProvider } from './step-up';

export function Providers({ children }: { children: ReactNode }) {
  const [client] = useState(
    () => new QueryClient({ defaultOptions: { queries: { staleTime: 30_000, retry: 1 } } }),
  );
  return (
    <QueryClientProvider client={client}>
      <SessionSync />
      <RealtimeProvider>
        <StepUpProvider>{children}</StepUpProvider>
      </RealtimeProvider>
    </QueryClientProvider>
  );
}

function SessionSync() {
  useSessionSync();
  return null;
}
