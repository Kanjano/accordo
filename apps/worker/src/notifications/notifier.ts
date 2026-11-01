import type { PrismaClient } from '@accordo/db';
import { type EmailProvider, renderEmail } from '@accordo/emails';
import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import type { Emitter } from '@socket.io/redis-emitter';
import { ENV, type Env } from '../env.js';
import { EMAIL, PRISMA, REALTIME } from '../infra.js';

export interface NotificationRequest {
  userId: string;
  /** Notification-preference key (SPEC §3.9), e.g. "listing.lifecycle". */
  preference: string;
  /** Stored type, e.g. "listing.expiring". */
  type: string;
  title: string;
  body: string;
  /** Relative web path. */
  path?: string;
  cta?: string;
  data?: Record<string, unknown>;
  mandatory?: boolean;
}

/** In-app + email delivery according to the user's preferences (mandatory types ignore opt-outs). */
@Injectable()
export class Notifier {
  private readonly logger = new Logger(Notifier.name);

  constructor(
    @Inject(ENV) private readonly env: Env,
    @Inject(PRISMA) private readonly db: PrismaClient,
    @Inject(EMAIL) private readonly email: EmailProvider,
    @Optional() @Inject(REALTIME) private readonly realtime?: Emitter,
  ) {}

  /** People without an account (anonymous DSA reporters): email only. */
  async emailTo(to: string, n: { name: string; title: string; body: string; path?: string }) {
    const rendered = await renderEmail('notification', {
      name: n.name,
      title: n.title,
      body: n.body,
      url: n.path ? `${this.env.WEB_URL}${n.path}` : undefined,
    });
    await this.email.send({ to, ...rendered });
  }

  async notify(n: NotificationRequest): Promise<void> {
    const user = await this.db.user.findUnique({
      where: { id: n.userId },
      select: {
        email: true,
        name: true,
        emailVerified: true,
        status: true,
        notificationPrefs: { where: { type: n.preference } },
      },
    });
    if (!user || user.status === 'DELETED') return;
    const enabled = (channel: 'IN_APP' | 'EMAIL') =>
      n.mandatory || (user.notificationPrefs.find((p) => p.channel === channel)?.enabled ?? true);
    const url = n.path ? `${this.env.WEB_URL}${n.path}` : undefined;

    if (enabled('IN_APP')) {
      await this.db.notification.create({
        data: {
          userId: n.userId,
          type: n.type,
          title: n.title,
          body: n.body,
          data: { ...n.data, ...(n.path ? { path: n.path } : {}) },
        },
      });
      // Realtime bell (SPEC §5.6); best effort, the unread count is also polled.
      this.realtime
        ?.to(`user:${n.userId}`)
        .emit('notification:new', { type: n.type, title: n.title });
    }
    if (enabled('EMAIL') && user.emailVerified) {
      const rendered = await renderEmail('notification', {
        name: user.name,
        title: n.title,
        body: n.body,
        url,
        cta: n.cta,
      });
      try {
        await this.email.send({ to: user.email, ...rendered });
      } catch (e) {
        this.logger.error(`Email ${n.type} to user ${n.userId} failed: ${String(e)}`);
        throw e;
      }
    }
  }
}
