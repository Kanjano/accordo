import { randomBytes } from 'node:crypto';
import type { PrismaClient } from '@accordo/db';
import { BadRequestException, Body, Controller, HttpCode, Inject, Post, Req } from '@nestjs/common';
import { z } from 'zod';
import { ENV, type Env } from '../../config/env.js';
import { PRISMA } from '../platform/infra.providers.js';
import { type AuthenticatedRequest, Public } from './auth.decorators.js';
import type { Auth } from './auth.factory.js';
import { AUTH } from './auth.tokens.js';
import { verifyNotMeToken } from './not-me.js';

const notMeSchema = z.object({ token: z.string().min(10).max(200) });

@Controller('auth/not-me')
export class NotMeController {
  constructor(
    @Inject(AUTH) private readonly auth: Auth,
    @Inject(PRISMA) private readonly db: PrismaClient,
    @Inject(ENV) private readonly env: Env,
  ) {}

  /**
   * "Non sono stato io" (SPEC §13.3): signs out every device, makes the current password unusable
   * and emails a reset link. A POST from a confirmation page, so mail scanners cannot trigger it.
   */
  @Post()
  @Public()
  @HttpCode(204)
  async lock(
    @Req() req: AuthenticatedRequest,
    @Body({ schema: notMeSchema }) body: z.infer<typeof notMeSchema>,
  ): Promise<void> {
    const userId = verifyNotMeToken(this.env.BETTER_AUTH_SECRET, body.token);
    const user = userId
      ? await this.db.user.findUnique({ where: { id: userId }, select: { id: true, email: true } })
      : null;
    if (!user) throw new BadRequestException({ code: 'INVALID_LINK' });
    const ctx = await this.auth.$context;
    const unusable = await ctx.password.hash(randomBytes(32).toString('base64url'));
    await this.db.$transaction([
      this.db.session.deleteMany({ where: { userId: user.id } }),
      this.db.account.updateMany({
        where: { userId: user.id, providerId: 'credential' },
        data: { password: unusable },
      }),
      this.db.auditLog.create({
        data: {
          actorId: user.id,
          actorRole: 'user',
          action: 'user.not_me',
          entityType: 'User',
          entityId: user.id,
          ip: req.ip,
          userAgent: req.headers['user-agent'],
        },
      }),
    ]);
    await this.auth.api.requestPasswordReset({
      body: { email: user.email, redirectTo: `${this.env.WEB_URL}/reimposta-password` },
    });
  }
}
