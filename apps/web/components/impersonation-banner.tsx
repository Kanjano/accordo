'use client';
import { Button } from '@accordo/ui';
import { useTranslations } from 'next-intl';
import { authClient, useSession } from '@/lib/auth-client';

/** Read-only impersonation (SPEC §3.10): always visible, one click back to the admin. */
export function ImpersonationBanner() {
  const t = useTranslations('Admin');
  const { data } = useSession();
  if (!(data?.session as { impersonatedBy?: string | null } | undefined)?.impersonatedBy)
    return null;
  return (
    <div role="alert" className="bg-amber-300 px-4 py-2 text-center text-sm text-black">
      {t('impersonating', { email: data?.user.email ?? '' })}{' '}
      <Button
        size="sm"
        variant="outline"
        className="ml-2 h-7"
        onClick={async () => {
          await authClient.admin.stopImpersonating();
          window.location.assign('/admin/utenti');
        }}
      >
        {t('stopImpersonating')}
      </Button>
    </div>
  );
}
