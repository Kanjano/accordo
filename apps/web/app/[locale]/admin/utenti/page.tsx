import { Suspense } from 'react';
import { AdminUsers } from '@/components/admin/users';

export default function Page() {
  return (
    <Suspense>
      <AdminUsers />
    </Suspense>
  );
}
