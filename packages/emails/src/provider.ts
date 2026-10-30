import nodemailer, { type Transporter } from 'nodemailer';

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

export interface EmailConfig {
  EMAIL_PROVIDER: 'smtp';
  EMAIL_FROM: string;
  SMTP_HOST: string;
  SMTP_PORT: number;
}

// ponytail: only SMTP for now; the production API provider is added before launch (ADR-0019).
export function createEmailProvider(config: EmailConfig): EmailProvider {
  return new SmtpEmailProvider(config.EMAIL_FROM, config.SMTP_HOST, config.SMTP_PORT);
}
