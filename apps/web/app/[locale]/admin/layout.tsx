import type { Metadata } from 'next';
import { AccountShell } from '@/components/account/account-shell';
import { AdminNav } from '@/components/admin/admin-nav';

export const metadata: Metadata = { robots: { index: false, follow: false } };

export default function AdminLayout({ children }: LayoutProps<'/[locale]/admin'>) {
  return (
    <AccountShell bare>
      <div className="mx-auto grid max-w-6xl gap-6 px-4 py-8">
        <AdminNav />
        {children}
      </div>
    </AccountShell>
  );
}
