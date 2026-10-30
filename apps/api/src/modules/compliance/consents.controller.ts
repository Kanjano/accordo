import type { PrismaClient } from '@accordo/db';
import { type ConsentInput, consentSchema } from '@accordo/shared';
import { Body, Controller, HttpCode, Inject, Post, Req } from '@nestjs/common';
import { type AuthenticatedRequest, CurrentAuth, Public } from '../auth/auth.decorators.js';
import type { AuthSession } from '../auth/auth.factory.js';
import { ipPrefix } from '../auth/devices.service.js';
import { PRISMA } from '../platform/infra.providers.js';
import { RateLimitService } from '../platform/rate-limit.service.js';

/** Cookie consent register (SPEC §14.5): one append-only audit row per choice. */
@Controller('consents')
export class ConsentsController {
  constructor(
    @Inject(PRISMA) private readonly db: PrismaClient,
    private readonly rateLimit: RateLimitService,
  ) {}

  @Post()
  @Public()
  @HttpCode(204)
  async record(
    @Body({ schema: consentSchema }) body: ConsentInput,
    @CurrentAuth() auth: AuthSession | null,
    @Req() req: AuthenticatedRequest,
  ): Promise<void> {
    await this.rateLimit.consume(`consent:${req.ip}`, 30, 3600);
    await this.db.auditLog.create({
      data: {
        actorId: auth?.user.id ?? null,
        action: 'cookie.consent',
        entityType: 'CookieConsent',
        ip: ipPrefix(req.ip),
        userAgent: req.headers['user-agent']?.slice(0, 300),
        metadata: body,
      },
    });
  }
}
