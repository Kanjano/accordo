'use client';
import { Turnstile as CfTurnstile } from '@marsidev/react-turnstile';

/** Cloudflare Turnstile; renders nothing (and needs no token) when no site key is configured. */
export const turnstileEnabled = Boolean(process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY);

export function Turnstile({ onToken }: { onToken: (token: string | null) => void }) {
  const siteKey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;
  if (!siteKey) return null;
  return (
    <CfTurnstile
      siteKey={siteKey}
      options={{ language: 'it', size: 'flexible' }}
      onSuccess={onToken}
      onExpire={() => onToken(null)}
      onError={() => onToken(null)}
    />
  );
}

export const captchaHeaders = (token: string | null) =>
  token ? { 'x-captcha-response': token } : undefined;
