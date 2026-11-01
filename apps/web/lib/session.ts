'use client';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import type { authClient } from './auth-client';

/**
 * "Who is signed in" without the Better Auth client (~18 KB compressed): the header and the public
 * pages stay within the JavaScript budget (SPEC §12.4, ADR-0052). Auth forms still use authClient,
 * whose successful calls broadcast SESSION_CHANGED.
 */
export type Session = typeof authClient.$Infer.Session;

const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';
const KEY = ['session'];
export const SESSION_CHANGED = 'accordo:session-changed';

export function useSession() {
  const q = useQuery({
    queryKey: KEY,
    queryFn: async () => {
      const res = await fetch(`${API}/api/auth/get-session`, { credentials: 'include' });
      return res.ok ? ((await res.json()) as Session | null) : null;
    },
    staleTime: 60_000,
  });
  return { data: q.data ?? null, isPending: q.isPending, refetch: q.refetch };
}

export const notifySessionChanged = () => window.dispatchEvent(new Event(SESSION_CHANGED));

/** Mounted once in the providers: refreshes the session after sign-in, sign-out, 2FA… */
export function useSessionSync() {
  const qc = useQueryClient();
  useEffect(() => {
    const refresh = () => void qc.invalidateQueries({ queryKey: KEY });
    window.addEventListener(SESSION_CHANGED, refresh);
    return () => window.removeEventListener(SESSION_CHANGED, refresh);
  }, [qc]);
}

const post = (path: string) =>
  fetch(`${API}/api/auth${path}`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'content-type': 'application/json' },
    body: '{}',
  });

export async function signOut() {
  await post('/sign-out');
  notifySessionChanged();
}

export async function stopImpersonating() {
  await post('/admin/stop-impersonating');
  notifySessionChanged();
}
