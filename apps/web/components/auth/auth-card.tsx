import { Card, CardContent, CardDescription, CardHeader } from '@accordo/ui';
import type { ReactNode } from 'react';

export function AuthCard({
  title,
  description,
  children,
}: {
  title: string;
  description?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="mx-auto w-full max-w-md px-4 py-10 sm:py-16">
      <Card>
        <CardHeader>
          <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
          {description ? <CardDescription>{description}</CardDescription> : null}
        </CardHeader>
        <CardContent>{children}</CardContent>
      </Card>
    </div>
  );
}
