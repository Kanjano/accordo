import { type EmailProps, type EmailTemplate, renderEmail } from '@accordo/emails';
import { Inject, Injectable, Logger } from '@nestjs/common';
import nodemailer, { type Transporter } from 'nodemailer';
import type { Env } from '../../config/env.js';

export interface OutgoingEmail {
  to: string;
  subject: string;
  html: string;
  text: string;
}

/** Port: every email leaves through here (SMTP/Mailpit in development, EU provider in production). */
export interface EmailProvider {
  send(email: OutgoingEmail): Promise<void>;
}
export const EMAIL_PROVIDER = Symbol('EMAIL_PROVIDER');

export class SmtpEmailProvider implements EmailProvider {
  private readonly transport: Transporter;

  constructor(
    private readonly from: string,
    host: string,
    port: number,
  ) {
    this.transport = nodemailer.createTransport({ host, port, secure: port === 465 });
  }

  async send(email: OutgoingEmail): Promise<void> {
    await this.transport.sendMail({ from: this.from, ...email });
  }
}

export function createEmailProvider(env: Env): EmailProvider {
  // ponytail: only SMTP for now; the production API provider is added before launch (ADR-0019).
  return new SmtpEmailProvider(env.EMAIL_FROM, env.SMTP_HOST, env.SMTP_PORT);
}

/** Renders a typed template and sends it. Failures are logged, never leaked to the caller's response. */
@Injectable()
export class Mailer {
  private readonly logger = new Logger(Mailer.name);

  constructor(@Inject(EMAIL_PROVIDER) private readonly provider: EmailProvider) {}

  async send<T extends EmailTemplate>(
    to: string,
    template: T,
    props: EmailProps<T>,
  ): Promise<void> {
    const rendered = await renderEmail(template, props);
    try {
      await this.provider.send({ to, ...rendered });
    } catch (e) {
      this.logger.error(
        `Email "${template}" not sent: ${e instanceof Error ? e.message : String(e)}`,
      );
      throw e;
    }
  }
}
