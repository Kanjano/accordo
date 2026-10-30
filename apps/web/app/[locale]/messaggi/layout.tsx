import type { Metadata } from 'next';
import { AccountShell } from '@/components/account/account-shell';

export const metadata: Metadata = { robots: { index: false, follow: false } };

export default function MessagesLayout({ children }: LayoutProps<'/[locale]/messaggi'>) {
  return <AccountShell bare>{children}</AccountShell>;
}
