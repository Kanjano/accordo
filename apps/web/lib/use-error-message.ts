'use client';
import { useTranslations } from 'next-intl';
import { problemCode } from './api';

/** Maps API / Better Auth error codes to localised messages, with a generic fallback. */
export function useErrorMessage() {
  const t = useTranslations('Errors');
  return (error: unknown): string => {
    const code = problemCode(error);
    return code && t.has(code as 'generic') ? t(code as 'generic') : t('generic');
  };
}

/** Field validation messages: Zod messages are codes from @accordo/shared. */
export function useValidationMessage() {
  const t = useTranslations('Validation');
  return (message: string | undefined): string | undefined =>
    message === undefined
      ? undefined
      : t.has(message as 'invalid')
        ? t(message as 'invalid')
        : t('invalid');
}
