import {
  adminRefundSchema,
  appealDecisionSchema,
  disputeEvidenceSchema,
  disputeMessageSchema,
  disputeOpenSchema,
  disputeResolveSchema,
  disputeRespondSchema,
} from '@accordo/shared';
import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Res,
  StreamableFile,
} from '@nestjs/common';
import type { Response } from 'express';
import type { z } from 'zod';
import { CurrentAuth, Roles } from '../auth/auth.decorators.js';
import type { AuthSession } from '../auth/auth.factory.js';
import { IdempotencyService } from '../platform/idempotency.service.js';
import { DisputesService } from './disputes.service.js';
import { OrdersService } from './orders.service.js';

type Auth = AuthSession;
const STAFF = ['admin', 'support'];

@Controller()
export class DisputesController {
  constructor(
    private readonly disputes: DisputesService,
    private readonly orders: OrdersService,
    private readonly idempotency: IdempotencyService,
  ) {}

  @Post('orders/:id/dispute')
  open(
    @CurrentAuth() auth: Auth,
    @Param('id', ParseUUIDPipe) id: string,
    @Headers('idempotency-key') key: string | undefined,
    @Body({ schema: disputeOpenSchema }) body: z.infer<typeof disputeOpenSchema>,
  ) {
    return this.idempotency.run(auth.user.id, key, `POST /orders/${id}/dispute`, body, () =>
      this.disputes.open(auth.user.id, id, body),
    );
  }

  @Get('disputes/:id')
  detail(@CurrentAuth() auth: Auth, @Param('id', ParseUUIDPipe) id: string) {
    return this.disputes.detail(auth.user.id, id);
  }

  @Get('disputes/:id/evidence/:evidenceId')
  async evidence(
    @CurrentAuth() auth: Auth,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('evidenceId', ParseUUIDPipe) evidenceId: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    const staff = STAFF.includes(auth.user.role ?? '');
    const file = await this.disputes.evidenceFile(auth.user.id, id, evidenceId, staff);
    res.set({ 'content-type': file.mimeType, 'cache-control': 'private, no-store' });
    return new StreamableFile(file.body);
  }

  @Post('disputes/:id/messages')
  message(
    @CurrentAuth() auth: Auth,
    @Param('id', ParseUUIDPipe) id: string,
    @Body({ schema: disputeMessageSchema }) body: z.infer<typeof disputeMessageSchema>,
  ) {
    return this.disputes.message(auth.user.id, id, body.body);
  }

  @Post('disputes/:id/evidence')
  addEvidence(
    @CurrentAuth() auth: Auth,
    @Param('id', ParseUUIDPipe) id: string,
    @Body({ schema: disputeEvidenceSchema }) body: z.infer<typeof disputeEvidenceSchema>,
  ) {
    return this.disputes.addEvidence(auth.user.id, id, body.evidenceKeys);
  }

  @Post('disputes/:id/respond')
  respond(
    @CurrentAuth() auth: Auth,
    @Param('id', ParseUUIDPipe) id: string,
    @Body({ schema: disputeRespondSchema }) body: z.infer<typeof disputeRespondSchema>,
  ) {
    return this.disputes.act(
      auth.user.id,
      id,
      { type: 'SELLER_RESPOND', response: body.action, amountCents: body.amountCents },
      { message: body.message },
    );
  }

  @Post('disputes/:id/:action')
  party(
    @CurrentAuth() auth: Auth,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('action') action: string,
  ) {
    const type = (
      {
        'accept-proposal': 'ACCEPT_PROPOSAL',
        escalate: 'ESCALATE',
        withdraw: 'WITHDRAW',
        appeal: 'APPEAL',
      } as const
    )[action];
    if (!type) throw new BadRequestException({ code: 'INVALID_ACTION' });
    return this.disputes.act(auth.user.id, id, { type });
  }

  // ───────────── Back office (SPEC §3.10) ─────────────

  @Get('admin/disputes')
  @Roles(...STAFF)
  adminList(@Query('status') status?: string) {
    return this.disputes.adminList(status);
  }

  @Get('admin/disputes/:id')
  @Roles(...STAFF)
  adminDetail(@CurrentAuth() auth: Auth, @Param('id', ParseUUIDPipe) id: string) {
    return this.disputes.detail(auth.user.id, id, true);
  }

  /** Asks the parties for more evidence (48 hours, SPEC §6.6), as a support message. */
  @Post('admin/disputes/:id/request-evidence')
  @Roles(...STAFF)
  requestEvidence(
    @CurrentAuth() auth: Auth,
    @Param('id', ParseUUIDPipe) id: string,
    @Body({ schema: disputeMessageSchema }) body: z.infer<typeof disputeMessageSchema>,
  ) {
    return this.disputes.message(auth.user.id, id, body.body, true);
  }

  @Post('admin/disputes/:id/resolve')
  @Roles(...STAFF)
  resolve(
    @CurrentAuth() auth: Auth,
    @Param('id', ParseUUIDPipe) id: string,
    @Body({ schema: disputeResolveSchema }) body: z.infer<typeof disputeResolveSchema>,
  ) {
    return this.disputes.act(
      auth.user.id,
      id,
      {
        type: 'RESOLVE',
        outcome: body.outcome,
        refundCents: body.refundCents,
        sellerAtFault: body.sellerAtFault,
      },
      { notes: body.notes, staff: true },
    );
  }

  @Post('admin/disputes/:id/appeal-decision')
  @Roles(...STAFF)
  appealDecision(
    @CurrentAuth() auth: Auth,
    @Param('id', ParseUUIDPipe) id: string,
    @Body({ schema: appealDecisionSchema }) body: z.infer<typeof appealDecisionSchema>,
  ) {
    return this.disputes.act(
      auth.user.id,
      id,
      { type: 'APPEAL_DECISION', upheld: body.upheld },
      { notes: body.notes, staff: true },
    );
  }

  /** Manual refund on a completed order (e.g. an overturned appeal), SPEC §11.2. */
  @Post('admin/orders/:id/refund')
  @Roles('admin', 'support')
  @HttpCode(202)
  refund(
    @CurrentAuth() auth: Auth,
    @Param('id', ParseUUIDPipe) id: string,
    @Body({ schema: adminRefundSchema }) body: z.infer<typeof adminRefundSchema>,
  ) {
    return this.orders.adminRefund(auth.user.id, id, body.amountCents, body.reason);
  }
}
