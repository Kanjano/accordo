'use client';
import type { ServerToClientEvents } from '@accordo/shared';
import { useQueryClient } from '@tanstack/react-query';
import { createContext, type ReactNode, useContext, useEffect, useState } from 'react';
import type { Socket } from 'socket.io-client';
import { useSession } from '@/lib/session';

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
    // Loaded on demand: anonymous visitors never download the Socket.IO client.
    let socket: Socket<ServerToClientEvents> | undefined;
    let closed = false;
    void import('socket.io-client').then(({ io }) => {
      if (closed) return;
      socket = io(process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000', {
        path: '/ws',
        withCredentials: true,
        transports: ['websocket', 'polling'],
      });
      listen(socket);
    });
    const refresh = (...keys: unknown[][]) => {
      for (const queryKey of keys) void qc.invalidateQueries({ queryKey });
    };
    const listen = (s: Socket<ServerToClientEvents>) => {
      s.on('connect', () => setConnected(true));
      s.on('disconnect', () => setConnected(false));
      s.on('message:new', ({ conversationId }) =>
        refresh(['messages', conversationId], ['conversations'], ['conversations-unread']),
      );
      s.on('conversation:read', ({ conversationId }) => refresh(['messages', conversationId]));
      s.on('offer:updated', ({ conversationId }) =>
        refresh(['conversation', conversationId], ['messages', conversationId], ['my-offers']),
      );
      s.on('notification:new', () => refresh(['notifications-unread'], ['notifications']));
    };
    return () => {
      closed = true;
      socket?.disconnect();
      setConnected(false);
    };
  }, [userId, qc]);

  return <Connected value={connected}>{children}</Connected>;
}
