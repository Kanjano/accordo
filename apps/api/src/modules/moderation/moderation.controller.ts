import type { PrismaClient } from '@accordo/db';
import {
  moderationAppealDecisionSchema,
  moderationAppealSchema,
  moderationReasonSchema,
  type ReportCreate,
  type ReportDecisionInput,
  reinstateSchema,
  reportCreateSchema,
  reportDecisionSchema,
  sanctionSchema,
} from '@accordo/shared';
import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import { fromNodeHeaders } from 'better-auth/node';
import type { Response } from 'express';
import type { z } from 'zod';
import {
  type AuthenticatedRequest,
  CurrentAuth,
  Public,
  RequireStepUp,
  Roles,
} from '../auth/auth.decorators.js';
import type { Auth, AuthSession } from '../auth/auth.factory.js';
import { AUTH } from '../auth/auth.tokens.js';
import { PRISMA } from '../platform/infra.providers.js';
import { ModerationService } from './moderation.service.js';

const STAFF = ['admin', 'moderator', 'support'];
const MODERATORS = ['admin', 'moderator'];
type Reason = z.infer<typeof moderationReasonSchema>;

@Controller()
export class ModerationController {
  constructor(
    private readonly moderation: ModerationService,
    @Inject(AUTH) private readonly auth: Auth,
    @Inject(PRISMA) private readonly db: PrismaClient,
  ) {}

  // ───────────── Users ─────────────

  @Post('reports')
  @Public()
  @HttpCode(201)
  report(
    @CurrentAuth() auth: AuthSession | null,
    @Req() req: AuthenticatedRequest,
    @Body({ schema: reportCreateSchema }) body: ReportCreate,
  ) {
    const captcha = req.headers['x-captcha-response'];
    return this.moderation.report(auth?.user.id ?? null, body, {
      ip: req.ip,
      captcha: typeof captcha === 'string' ? captcha : undefined,
    });
  }

  @Get('me/reports')
  myReports(@CurrentAuth() auth: AuthSession) {
    return this.moderation.myReports(auth.user.id);
  }

  @Get('me/moderation-actions')
  myActions(@CurrentAuth() auth: AuthSession) {
    return this.moderation.myActions(auth.user.id);
  }

  @Post('moderation-actions/:id/appeal')
  appeal(
    @CurrentAuth() auth: AuthSession,
    @Param('id', ParseUUIDPipe) id: string,
    @Body({ schema: moderationAppealSchema }) body: z.infer<typeof moderationAppealSchema>,
  ) {
    return this.moderation.appeal(auth.user.id, id, body.text);
  }

  // ───────────── Staff: reports and listings ─────────────

  @Get('admin/reports')
  @Roles(...STAFF)
  reports(@Query('status') status?: string) {
    return this.moderation.adminReports(status === 'CLOSED' ? 'CLOSED' : 'OPEN');
  }

  @Post('admin/reports/:id/decide')
  @Roles(...MODERATORS)
  @HttpCode(204)
  async decide(
    @CurrentAuth() auth: AuthSession,
    @Param('id', ParseUUIDPipe) id: string,
    @Body({ schema: reportDecisionSchema }) body: ReportDecisionInput,
  ) {
    await this.moderation.decide(auth.user.id, id, body);
  }

  @Get('admin/listings')
  @Roles(...STAFF)
  listings(@Query('status') status?: string) {
    return this.moderation.adminListings(
      status === 'REMOVED' || status === 'REJECTED' || status === 'REPORTED'
        ? status
        : 'PENDING_REVIEW',
    );
  }

  @Post('admin/listings/:id/approve')
  @Roles(...MODERATORS)
  @HttpCode(204)
  async approve(@CurrentAuth() auth: AuthSession, @Param('id', ParseUUIDPipe) id: string) {
    await this.moderation.approveListing(auth.user.id, id);
  }

  @Post('admin/listings/:id/reject')
  @Roles(...MODERATORS)
  @HttpCode(204)
  async reject(
    @CurrentAuth() auth: AuthSession,
    @Param('id', ParseUUIDPipe) id: string,
    @Body({ schema: moderationReasonSchema }) body: Reason,
  ) {
    await this.moderation.listingAction(auth.user.id, id, 'LISTING_REJECTED', body);
  }

  @Post('admin/listings/:id/remove')
  @Roles(...MODERATORS)
  @HttpCode(204)
  async remove(
    @CurrentAuth() auth: AuthSession,
    @Param('id', ParseUUIDPipe) id: string,
    @Body({ schema: moderationReasonSchema }) body: Reason,
  ) {
    await this.moderation.listingAction(auth.user.id, id, 'LISTING_REMOVED', body);
  }

  @Post('admin/listings/:id/restore')
  @Roles(...MODERATORS)
  @HttpCode(204)
  async restore(
    @CurrentAuth() auth: AuthSession,
    @Param('id', ParseUUIDPipe) id: string,
    @Body({ schema: reinstateSchema }) body: z.infer<typeof reinstateSchema>,
  ) {
    await this.moderation.listingAction(auth.user.id, id, 'LISTING_RESTORED', {
      reasonCode: 'OTHER',
      statement: body.statement,
    });
  }

  // ───────────── Staff: appeals ─────────────

  @Get('admin/appeals')
  @Roles(...MODERATORS)
  appeals() {
    return this.moderation.adminAppeals();
  }

  @Post('admin/moderation-actions/:id/appeal-decision')
  @Roles(...MODERATORS)
  @HttpCode(204)
  async decideAppeal(
    @CurrentAuth() auth: AuthSession,
    @Param('id', ParseUUIDPipe) id: string,
    @Body({ schema: moderationAppealDecisionSchema })
    body: z.infer<typeof moderationAppealDecisionSchema>,
  ) {
    await this.moderation.decideAppeal(auth.user.id, id, body.outcome, body.statement);
  }

  // ───────────── Staff: users and sanctions ─────────────

  @Get('admin/users')
  @Roles(...STAFF)
  users(@Query('q') q?: string) {
    return this.moderation.adminUsers(q);
  }

  @Get('admin/users/:id')
  @Roles(...STAFF)
  user(@Param('id', ParseUUIDPipe) id: string) {
    return this.moderation.adminUser(id);
  }

  @Post('admin/users/:id/sanction')
  @Roles(...MODERATORS)
  @RequireStepUp()
  async sanction(
    @CurrentAuth() auth: AuthSession,
    @Param('id', ParseUUIDPipe) id: string,
    @Body({ schema: sanctionSchema }) body: z.infer<typeof sanctionSchema>,
  ) {
    return { actionId: await this.moderation.sanction(auth.user.id, id, body) };
  }

  @Post('admin/users/:id/reinstate')
  @Roles(...MODERATORS)
  @RequireStepUp()
  async reinstate(
    @CurrentAuth() auth: AuthSession,
    @Param('id', ParseUUIDPipe) id: string,
    @Body({ schema: reinstateSchema }) body: z.infer<typeof reinstateSchema>,
  ) {
    return { actionId: await this.moderation.reinstate(auth.user.id, id, body.statement) };
  }

  /**
   * Read-only impersonation (SPEC §3.10, §5.5): Better Auth's admin plugin creates the session,
   * the global guard refuses every write while `impersonatedBy` is set. Admins only, audited.
   */
  @Post('admin/users/:id/impersonate')
  @Roles('admin')
  @RequireStepUp()
  @HttpCode(204)
  async impersonate(
    @CurrentAuth() auth: AuthSession,
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: AuthenticatedRequest,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.auth.api.impersonateUser({
      body: { userId: id },
      headers: fromNodeHeaders(req.headers),
      returnHeaders: true,
    });
    const cookies = result.headers.getSetCookie();
    if (cookies.length) res.setHeader('set-cookie', cookies);
    await this.db.auditLog.create({
      data: {
        actorId: auth.user.id,
        actorRole: auth.user.role ?? 'admin',
        action: 'user.impersonate',
        entityType: 'User',
        entityId: id,
        ip: req.ip,
        userAgent: req.headers['user-agent'],
      },
    });
  }
}
