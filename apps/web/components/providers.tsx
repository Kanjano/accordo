'use client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { type ReactNode, useState } from 'react';
import { RealtimeProvider } from '@/lib/realtime';
import { StepUpProvider } from './step-up';

export function Providers({ children }: { children: ReactNode }) {
  const [client] = useState(
    () => new QueryClient({ defaultOptions: { queries: { staleTime: 30_000, retry: 1 } } }),
  );
  return (
    <QueryClientProvider client={client}>
      <RealtimeProvider>
        <StepUpProvider>{children}</StepUpProvider>
      </RealtimeProvider>
    </QueryClientProvider>
  );
}
