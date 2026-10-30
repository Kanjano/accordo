'use client';
import type { ServerToClientEvents } from '@accordo/shared';
import { useQueryClient } from '@tanstack/react-query';
import { createContext, type ReactNode, useContext, useEffect, useState } from 'react';
import { io, type Socket } from 'socket.io-client';
import { useSession } from '@/lib/auth-client';

const Connected = createContext(false);

/** True while the socket is up; otherwise screens poll (SPEC §3.5 fallback). */
export const useRealtimeConnected = () => useContext(Connected);

/** Socket.IO on the API `/ws` (SPEC §5.6): server events invalidate the matching queries. */
export function RealtimeProvider({ children }: { children: ReactNode }) {
  const { data: session } = useSession();
  const qc = useQueryClient();
  const [connected, setConnected] = useState(false);
  const userId = session?.user.id;

  useEffect(() => {
    if (!userId) return;
    const socket: Socket<ServerToClientEvents> = io(
      process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000',
      { path: '/ws', withCredentials: true, transports: ['websocket', 'polling'] },
    );
    const refresh = (...keys: unknown[][]) => {
      for (const queryKey of keys) void qc.invalidateQueries({ queryKey });
    };
    socket.on('connect', () => setConnected(true));
    socket.on('disconnect', () => setConnected(false));
    socket.on('message:new', ({ conversationId }) =>
      refresh(['messages', conversationId], ['conversations'], ['conversations-unread']),
    );
    socket.on('conversation:read', ({ conversationId }) => refresh(['messages', conversationId]));
    socket.on('offer:updated', ({ conversationId }) =>
      refresh(['conversation', conversationId], ['messages', conversationId], ['my-offers']),
    );
    socket.on('notification:new', () => refresh(['notifications-unread'], ['notifications']));
    return () => {
      socket.disconnect();
      setConnected(false);
    };
  }, [userId, qc]);

  return <Connected value={connected}>{children}</Connected>;
}
