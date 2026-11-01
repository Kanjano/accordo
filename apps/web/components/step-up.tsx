'use client';
import type { StepUpRequirement, StepUpStatus } from '@accordo/shared';
import { Alert, Button, Field, Input } from '@accordo/ui';
import { useTranslations } from 'next-intl';
import {
  createContext,
  type FormEvent,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react';
import { ApiError, api, problemCode } from '@/lib/api';
import { useSession } from '@/lib/session';
import { useErrorMessage } from '@/lib/use-error-message';

type WithStepUp = <T>(action: () => Promise<T>) => Promise<T>;
const StepUpContext = createContext<WithStepUp>((action) => action());

/** Runs an action; on STEP_UP_REQUIRED asks for password and/or emailed code, then retries once. */
export const useStepUp = () => useContext(StepUpContext);

interface Pending {
  requires: StepUpRequirement[];
  resolve: () => void;
  reject: (e: unknown) => void;
}

export function StepUpProvider({ children }: { children: ReactNode }) {
  const [pending, setPending] = useState<Pending | null>(null);

  const withStepUp = useCallback<WithStepUp>(async (action) => {
    try {
      return await action();
    } catch (error) {
      if (problemCode(error) !== 'STEP_UP_REQUIRED') throw error;
      const requires =
        error instanceof ApiError && error.problem.requires?.length
          ? error.problem.requires
          : (await api.get<StepUpStatus>('/api/v1/auth/step-up')).requires;
      await new Promise<void>((resolve, reject) =>
        setPending({ requires, resolve, reject: () => reject(error) }),
      );
      return action();
    }
  }, []);

  return (
    <StepUpContext.Provider value={withStepUp}>
      {children}
      {pending ? (
        <StepUpDialog
          requires={pending.requires}
          onDone={() => {
            pending.resolve();
            setPending(null);
          }}
          onCancel={() => {
            pending.reject(null);
            setPending(null);
          }}
        />
      ) : null}
    </StepUpContext.Provider>
  );
}

function StepUpDialog({
  requires,
  onDone,
  onCancel,
}: {
  requires: StepUpRequirement[];
  onDone: () => void;
  onCancel: () => void;
}) {
  const t = useTranslations('StepUp');
  const tc = useTranslations('Common');
  const errorMessage = useErrorMessage();
  const { data: session } = useSession();
  const ref = useRef<HTMLDialogElement>(null);
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [codeSent, setCodeSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const needsCode = requires.includes('email_code');
  const needsPassword = requires.includes('password');

  const sendCode = useCallback(async () => {
    setError(null);
    try {
      await api.post('/api/v1/auth/step-up/email-code');
      setCodeSent(true);
    } catch (e) {
      setError(errorMessage(e));
    }
  }, [errorMessage]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: open the dialog and send the code once, on mount
  useEffect(() => {
    ref.current?.showModal();
    if (needsCode) void sendCode();
  }, []);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.post('/api/v1/auth/step-up', {
        ...(needsPassword ? { password } : {}),
        ...(needsCode ? { emailCode: code } : {}),
      });
      onDone();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <dialog
      ref={ref}
      aria-labelledby="step-up-title"
      onCancel={onCancel}
      className="m-auto w-[min(28rem,calc(100vw-2rem))] rounded-xl border bg-background p-6 text-foreground backdrop:bg-black/50"
    >
      <form onSubmit={submit} className="grid gap-4">
        <h2 id="step-up-title" className="text-lg font-semibold">
          {t('title')}
        </h2>
        <p className="text-sm text-muted-foreground">
          {needsCode && !needsPassword ? t('newDevice') : t('text')}
        </p>
        {error ? <Alert tone="error">{error}</Alert> : null}
        {needsPassword ? (
          <Field label={t('password')}>
            <Input
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </Field>
        ) : null}
        {needsCode ? (
          <>
            {codeSent ? (
              <Alert tone="info">{t('codeSent', { email: session?.user.email ?? '' })}</Alert>
            ) : null}
            <Field label={t('emailCode')}>
              <Input
                inputMode="numeric"
                autoComplete="one-time-code"
                pattern="\d{6}"
                maxLength={6}
                required
                value={code}
                onChange={(e) => setCode(e.target.value)}
              />
            </Field>
            <Button variant="link" className="justify-self-start px-0" onClick={sendCode}>
              {codeSent ? t('resendCode') : t('sendCode')}
            </Button>
          </>
        ) : null}
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onCancel}>
            {tc('cancel')}
          </Button>
          <Button type="submit" disabled={busy}>
            {t('confirm')}
          </Button>
        </div>
      </form>
    </dialog>
  );
}
