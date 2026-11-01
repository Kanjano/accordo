import { QUEUES } from '@accordo/shared';
import { createBullBoard } from '@bull-board/api';
import { BullMQAdapter } from '@bull-board/api/bullMQAdapter';
import { ExpressAdapter } from '@bull-board/express';
import { Inject, Injectable, type OnModuleDestroy } from '@nestjs/common';
import { fromNodeHeaders } from 'better-auth/node';
import { Queue } from 'bullmq';
import type { NextFunction, Request, Response, Router } from 'express';
import { ENV, type Env } from '../../config/env.js';
import type { Auth } from '../auth/auth.factory.js';
import { AUTH } from '../auth/auth.tokens.js';

export const QUEUES_PATH = '/admin/queues';
const BOARD_ROLES = new Set(['admin', 'support']);

/**
 * Bull Board on the API host (SPEC §3.10): staff with 2FA only, no impersonated sessions, and
 * state-changing requests (retry, clean) only from the board itself.
 */
@Injectable()
export class QueuesBoard implements OnModuleDestroy {
  private readonly queues: Queue[];
  readonly router: Router;

  constructor(
    @Inject(ENV) private readonly env: Env,
    @Inject(AUTH) private readonly auth: Auth,
  ) {
    const url = new URL(env.REDIS_URL);
    const connection = {
      host: url.hostname,
      port: Number(url.port || 6379),
      ...(url.password ? { password: decodeURIComponent(url.password) } : {}),
      // Opening the page must not fail when Valkey is briefly unreachable.
      lazyConnect: true,
    };
    this.queues = Object.values(QUEUES).map((name) => new Queue(name, { connection }));
    const adapter = new ExpressAdapter();
    adapter.setBasePath(QUEUES_PATH);
    createBullBoard({
      queues: this.queues.map((q) => new BullMQAdapter(q)),
      serverAdapter: adapter,
      options: { uiConfig: { boardTitle: 'Accordo — code' } },
    });
    this.router = adapter.getRouter() as Router;
  }

  guard = async (req: Request, res: Response, next: NextFunction) => {
    const unsafe = !['GET', 'HEAD', 'OPTIONS'].includes(req.method);
    if (unsafe && req.headers.origin !== this.env.API_URL) return res.sendStatus(403);
    const session = await this.auth.api
      .getSession({ headers: fromNodeHeaders(req.headers) })
      .catch(() => null);
    const user = session?.user;
    if (!user)
      return res.redirect(`${this.env.WEB_URL}/accedi?next=${encodeURIComponent('/admin')}`);
    if (
      !BOARD_ROLES.has(user.role ?? 'user') ||
      !user.twoFactorEnabled ||
      session.session.impersonatedBy
    )
      return res.sendStatus(403);
    return next();
  };

  async onModuleDestroy() {
    await Promise.all(this.queues.map((q) => q.close()));
  }
}
