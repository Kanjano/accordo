'use client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { useSession } from '@/lib/auth-client';

const KEY = ['favorite-ids'];

/** Favorite ids of the signed-in user, with optimistic toggling. */
export function useFavorites() {
  const { data: session } = useSession();
  const qc = useQueryClient();
  const { data: ids = [] } = useQuery({
    queryKey: KEY,
    queryFn: () => api.get<string[]>('/api/v1/me/favorites/ids'),
    enabled: !!session,
  });
  const mutation = useMutation({
    mutationFn: ({ id, on }: { id: string; on: boolean }) =>
      on
        ? api.put(`/api/v1/listings/${id}/favorite`)
        : api.delete(`/api/v1/listings/${id}/favorite`),
    onMutate: async ({ id, on }) => {
      await qc.cancelQueries({ queryKey: KEY });
      const previous = qc.getQueryData<string[]>(KEY) ?? [];
      qc.setQueryData(KEY, on ? [id, ...previous] : previous.filter((x) => x !== id));
      return { previous };
    },
    onError: (_e, _v, ctx) => qc.setQueryData(KEY, ctx?.previous),
    onSettled: () => qc.invalidateQueries({ queryKey: KEY }),
  });
  return {
    signedIn: !!session,
    isFavorite: (id: string) => ids.includes(id),
    toggle: (id: string) => mutation.mutate({ id, on: !ids.includes(id) }),
  };
}
