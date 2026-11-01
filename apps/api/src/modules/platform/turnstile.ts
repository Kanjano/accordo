/** Cloudflare Turnstile server-side check; without a secret key (development, tests) it always passes. */
export async function verifyTurnstile(
  secret: string,
  token: string | null | undefined,
  ip?: string,
): Promise<boolean> {
  if (!secret) return true;
  const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
    method: 'POST',
    body: new URLSearchParams({ secret, response: token ?? '', ...(ip ? { remoteip: ip } : {}) }),
  }).catch(() => null);
  return Boolean(res?.ok && ((await res.json()) as { success?: boolean }).success);
}
