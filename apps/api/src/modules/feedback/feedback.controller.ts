import {
  type FeedbackCreate,
  feedbackCreateSchema,
  feedbackModerationSchema,
  feedbackReplySchema,
  feedbackReportSchema,
  revisionAcceptSchema,
  revisionRequestSchema,
} from '@accordo/shared';
import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import type { z } from 'zod';
import { CurrentAuth, Public, Roles } from '../auth/auth.decorators.js';
import type { AuthSession } from '../auth/auth.factory.js';
import { FeedbackService } from './feedback.service.js';

type Auth = AuthSession;
const STAFF = ['admin', 'moderator', 'support'];

@Controller()
export class FeedbackController {
  constructor(private readonly feedback: FeedbackService) {}

  @Get('users/:username/reputation')
  @Public()
  reputation(@Param('username') username: string) {
    return this.feedback.reputation(username);
  }

  @Get('users/:username/feedback')
  @Public()
  list(
    @Param('username') username: string,
    @CurrentAuth() auth: Auth | null,
    @Query() q: { role?: string; rating?: string; period?: string; cursor?: string },
  ) {
    return this.feedback.list(username, auth?.user.id ?? null, q);
  }

  @Get('me/feedback/pending')
  pending(@CurrentAuth() auth: Auth) {
    return this.feedback.pending(auth.user.id);
  }

  @Get('me/feedback')
  mine(@CurrentAuth() auth: Auth, @Query('kind') kind = 'received') {
    if (kind !== 'received' && kind !== 'left')
      throw new BadRequestException({ code: 'INVALID_KIND' });
    return this.feedback.mine(auth.user.id, kind);
  }

  @Get('me/revision-requests')
  requests(@CurrentAuth() auth: Auth) {
    return this.feedback.requests(auth.user.id);
  }

  @Post('orders/:id/feedback')
  leave(
    @CurrentAuth() auth: Auth,
    @Param('id', ParseUUIDPipe) id: string,
    @Body({ schema: feedbackCreateSchema }) body: FeedbackCreate,
  ) {
    return this.feedback.leave(auth.user.id, id, body);
  }

  @Post('feedback/:id/reply')
  reply(
    @CurrentAuth() auth: Auth,
    @Param('id', ParseUUIDPipe) id: string,
    @Body({ schema: feedbackReplySchema }) body: z.infer<typeof feedbackReplySchema>,
  ) {
    return this.feedback.reply(auth.user.id, id, body.body);
  }

  @Post('feedback/:id/revision-request')
  requestRevision(
    @CurrentAuth() auth: Auth,
    @Param('id', ParseUUIDPipe) id: string,
    @Body({ schema: revisionRequestSchema }) body: z.infer<typeof revisionRequestSchema>,
  ) {
    return this.feedback.requestRevision(auth.user.id, id, body.message);
  }

  @Post('revision-requests/:id/accept')
  accept(
    @CurrentAuth() auth: Auth,
    @Param('id', ParseUUIDPipe) id: string,
    @Body({ schema: revisionAcceptSchema }) body: z.infer<typeof revisionAcceptSchema>,
  ) {
    return this.feedback.answerRevision(auth.user.id, id, true, body);
  }

  @Post('revision-requests/:id/decline')
  decline(@CurrentAuth() auth: Auth, @Param('id', ParseUUIDPipe) id: string) {
    return this.feedback.answerRevision(auth.user.id, id, false);
  }

  @Post('feedback/:id/report')
  @HttpCode(204)
  async report(
    @CurrentAuth() auth: Auth,
    @Param('id', ParseUUIDPipe) id: string,
    @Body({ schema: feedbackReportSchema }) body: z.infer<typeof feedbackReportSchema>,
  ) {
    await this.feedback.report(auth.user.id, id, body.reasonCode, body.details);
  }

  // ───────────── Moderation (SPEC §8.8) ─────────────

  @Get('admin/feedback')
  @Roles(...STAFF)
  queue() {
    return this.feedback.moderationQueue();
  }

  @Post('admin/feedback/:id/remove')
  @Roles(...STAFF)
  @HttpCode(204)
  async remove(
    @CurrentAuth() auth: Auth,
    @Param('id', ParseUUIDPipe) id: string,
    @Body({ schema: feedbackModerationSchema }) body: z.infer<typeof feedbackModerationSchema>,
  ) {
    await this.feedback.remove(auth.user.id, id, body.reasonCode, body.statement);
  }

  @Post('admin/feedback/:id/restore')
  @Roles(...STAFF)
  @HttpCode(204)
  async restore(@CurrentAuth() auth: Auth, @Param('id', ParseUUIDPipe) id: string) {
    await this.feedback.publish(auth.user.id, id);
  }
}
