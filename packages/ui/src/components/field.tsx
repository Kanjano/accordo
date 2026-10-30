'use client';
import { cloneElement, type ReactElement, type ReactNode, useId } from 'react';
import { cn } from '../lib/utils.js';
import { Label } from './input.js';

interface FieldProps {
  label: ReactNode;
  description?: ReactNode;
  error?: string | undefined;
  className?: string;
  /** A single form control; id and aria attributes are wired automatically. */
  children: ReactElement<Record<string, unknown>>;
}

/** Label + control + description + error, with aria-describedby/aria-invalid and a live error region. */
export function Field({ label, description, error, className, children }: FieldProps) {
  const id = useId();
  const descId = `${id}-desc`;
  const errId = `${id}-err`;
  const describedBy =
    [description ? descId : null, error ? errId : null].filter(Boolean).join(' ') || undefined;
  return (
    <div className={cn('grid gap-2', className)}>
      <Label htmlFor={id}>{label}</Label>
      {cloneElement(children, {
        id,
        'aria-invalid': error ? true : undefined,
        'aria-describedby': describedBy,
      })}
      {description ? (
        <p id={descId} className="text-sm text-muted-foreground">
          {description}
        </p>
      ) : null}
      <p id={errId} aria-live="polite" className="text-sm text-destructive empty:hidden">
        {error}
      </p>
    </div>
  );
}
