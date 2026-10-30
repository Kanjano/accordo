/** Better Auth client calls return { data, error }: turn errors into exceptions carrying the code. */
export async function unwrap<T>(
  promise: Promise<{
    data: T | null;
    error: { code?: string; message?: string; status?: number } | null;
  }>,
): Promise<T> {
  const { data, error } = await promise;
  if (error)
    throw Object.assign(new Error(error.message ?? 'Auth error'), {
      code: error.code ?? 'generic',
      status: error.status,
    });
  return data as T;
}
