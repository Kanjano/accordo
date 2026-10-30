import {
  conversationCreateSchema,
  messageCreateSchema,
  messageReportSchema,
  offerAmountSchema,
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
import { CurrentAuth } from '../auth/auth.decorators.js';
import type { AuthSession } from '../auth/auth.factory.js';
import { MessagingService } from './messaging.service.js';
import { OffersService } from './offers.service.js';

const cursorOf = (cursor?: string) => {
  if (cursor && !/^[0-9a-f-]{36}$/i.test(cursor))
    throw new BadRequestException({ code: 'INVALID_CURSOR' });
  return cursor;
};

@Controller()
export class MessagingController {
  constructor(
    private readonly messaging: MessagingService,
    private readonly offers: OffersService,
  ) {}

  @Get('conversations')
  list(
    @CurrentAuth() auth: AuthSession,
    @Query('cursor') cursor?: string,
    @Query('archived') archived?: string,
  ) {
    return this.messaging.list(auth.user.id, archived === 'true', cursorOf(cursor));
  }

  @Get('conversations/unread-count')
  unread(@CurrentAuth() auth: AuthSession) {
    return this.messaging.unreadCount(auth.user.id);
  }

  @Post('conversations')
  start(
    @CurrentAuth() auth: AuthSession,
    @Body({ schema: conversationCreateSchema }) body: z.infer<typeof conversationCreateSchema>,
  ) {
    return this.messaging.start(auth.user.id, body.listingId, body.body);
  }

  @Get('conversations/:id')
  detail(@CurrentAuth() auth: AuthSession, @Param('id', ParseUUIDPipe) id: string) {
    return this.messaging.detail(auth.user.id, id);
  }

  @Get('conversations/:id/messages')
  messages(
    @CurrentAuth() auth: AuthSession,
    @Param('id', ParseUUIDPipe) id: string,
    @Query('cursor') cursor?: string,
  ) {
    return this.messaging.messages(auth.user.id, id, cursorOf(cursor));
  }

  @Post('conversations/:id/messages')
  send(
    @CurrentAuth() auth: AuthSession,
    @Param('id', ParseUUIDPipe) id: string,
    @Body({ schema: messageCreateSchema }) body: z.infer<typeof messageCreateSchema>,
  ) {
    return this.messaging.send(auth.user.id, id, body.body);
  }

  @Post('conversations/:id/read')
  @HttpCode(204)
  async read(@CurrentAuth() auth: AuthSession, @Param('id', ParseUUIDPipe) id: string) {
    await this.messaging.markRead(auth.user.id, id);
  }

  @Post('conversations/:id/archive')
  @HttpCode(204)
  async archive(@CurrentAuth() auth: AuthSession, @Param('id', ParseUUIDPipe) id: string) {
    await this.messaging.archive(auth.user.id, id, true);
  }

  @Post('conversations/:id/unarchive')
  @HttpCode(204)
  async unarchive(@CurrentAuth() auth: AuthSession, @Param('id', ParseUUIDPipe) id: string) {
    await this.messaging.archive(auth.user.id, id, false);
  }

  @Post('messages/:id/report')
  @HttpCode(204)
  async report(
    @CurrentAuth() auth: AuthSession,
    @Param('id', ParseUUIDPipe) id: string,
    @Body({ schema: messageReportSchema }) body: z.infer<typeof messageReportSchema>,
  ) {
    await this.messaging.report(auth.user.id, id, body);
  }

  @Post('listings/:id/offers')
  offer(
    @CurrentAuth() auth: AuthSession,
    @Param('id', ParseUUIDPipe) id: string,
    @Body({ schema: offerAmountSchema }) body: z.infer<typeof offerAmountSchema>,
  ) {
    return this.offers.create(auth.user.id, id, body.amountCents);
  }

  @Get('me/offers')
  myOffers(@CurrentAuth() auth: AuthSession, @Query('role') role = 'buyer') {
    if (role !== 'buyer' && role !== 'seller')
      throw new BadRequestException({ code: 'INVALID_ROLE' });
    return this.offers.mine(auth.user.id, role);
  }

  @Post('offers/:id/counter')
  counter(
    @CurrentAuth() auth: AuthSession,
    @Param('id', ParseUUIDPipe) id: string,
    @Body({ schema: offerAmountSchema }) body: z.infer<typeof offerAmountSchema>,
  ) {
    return this.offers.act(auth.user.id, id, 'counter', body.amountCents);
  }

  @Post('offers/:id/:action')
  answer(
    @CurrentAuth() auth: AuthSession,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('action') action: string,
  ) {
    if (action !== 'accept' && action !== 'decline' && action !== 'withdraw')
      throw new BadRequestException({ code: 'INVALID_ACTION' });
    return this.offers.act(auth.user.id, id, action);
  }
}
