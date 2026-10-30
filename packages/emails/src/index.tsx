import { render } from '@react-email/render';
import type { ReactElement } from 'react';
import {
  NewDeviceLogin,
  Notification,
  PasswordChanged,
  ResetPassword,
  StepUpCode,
  VerifyEmail,
} from './templates.js';

export * from './provider.js';

export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
}

const templates = {
  verifyEmail: { subject: () => 'Conferma il tuo indirizzo email', component: VerifyEmail },
  resetPassword: { subject: () => 'Reimposta la password di Accordo', component: ResetPassword },
  newDeviceLogin: {
    subject: () => 'Nuovo accesso al tuo account Accordo',
    component: NewDeviceLogin,
  },
  stepUpCode: {
    subject: (p: { code: string }) => `${p.code} è il tuo codice di verifica`,
    component: StepUpCode,
  },
  passwordChanged: {
    subject: () => 'La tua password è stata cambiata',
    component: PasswordChanged,
  },
  notification: { subject: (p: { title: string }) => p.title, component: Notification },
} as const;

export type EmailTemplate = keyof typeof templates;
export type EmailProps<T extends EmailTemplate> = Parameters<(typeof templates)[T]['component']>[0];

/** Typed Italian templates rendered to HTML + plain text. */
export async function renderEmail<T extends EmailTemplate>(
  template: T,
  props: EmailProps<T>,
): Promise<RenderedEmail> {
  const t = templates[template];
  const Component = t.component as (p: EmailProps<T>) => ReactElement;
  const element = <Component {...props} />;
  return {
    subject: (t.subject as (p: EmailProps<T>) => string)(props),
    html: await render(element),
    text: await render(element, { plainText: true }),
  };
}
