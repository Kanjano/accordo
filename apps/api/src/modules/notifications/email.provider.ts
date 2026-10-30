import {
  type EmailProps,
  type EmailProvider,
  type EmailTemplate,
  renderEmail,
} from '@accordo/emails';
import { Inject, Injectable, Logger } from '@nestjs/common';

export type { EmailProvider, OutgoingEmail } from '@accordo/emails';
export const EMAIL_PROVIDER = Symbol('EMAIL_PROVIDER');

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
