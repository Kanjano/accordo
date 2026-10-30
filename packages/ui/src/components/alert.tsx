import type { HTMLAttributes } from 'react';
import { cn } from '../lib/utils.js';

const tones = {
  info: 'border-border bg-muted text-foreground',
  success:
    'border-emerald-600/30 bg-emerald-50 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-100',
  error: 'border-destructive/40 bg-destructive/10 text-foreground',
} as const;

/** Errors are announced assertively (role=alert), other tones politely (role=status). */
export function Alert({
  tone = 'info',
  className,
  ...props
}: HTMLAttributes<HTMLDivElement> & { tone?: keyof typeof tones }) {
  return (
    <div
      role={tone === 'error' ? 'alert' : 'status'}
      className={cn('rounded-md border p-3 text-sm', tones[tone], className)}
      {...props}
    />
  );
}
