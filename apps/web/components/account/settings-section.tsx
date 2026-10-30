import { Card, CardContent, CardDescription, CardHeader } from '@accordo/ui';
import type { ReactNode } from 'react';

export function SettingsSection({
  title,
  description,
  children,
  as: Heading = 'h2',
}: {
  title: string;
  description?: ReactNode;
  children: ReactNode;
  as?: 'h1' | 'h2';
}) {
  return (
    <Card>
      <CardHeader>
        <Heading className="text-lg font-semibold">{title}</Heading>
        {description ? <CardDescription>{description}</CardDescription> : null}
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}
