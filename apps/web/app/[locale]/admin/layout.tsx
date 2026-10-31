import type { Metadata } from 'next';
import { AccountShell } from '@/components/account/account-shell';

export const metadata: Metadata = { robots: { index: false, follow: false } };

export default function AdminLayout({ children }: LayoutProps<'/[locale]/admin'>) {
  return (
    <AccountShell bare>
      <div className="mx-auto max-w-6xl px-4 py-8">{children}</div>
    </AccountShell>
  );
}
