import { recentlyViewedSchema } from '@accordo/shared';
import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import type { z } from 'zod';
import { CurrentAuth } from '../auth/auth.decorators.js';
import type { AuthSession } from '../auth/auth.factory.js';
import { EngagementService } from './engagement.service.js';

const UUID = /^[0-9a-f-]{36}$/i;

@Controller()
export class EngagementController {
  constructor(private readonly engagement: EngagementService) {}

  @Get('me/favorites')
  favorites(@CurrentAuth() auth: AuthSession) {
    return this.engagement.favorites(auth.user.id);
  }

  @Get('me/favorites/ids')
  favoriteIds(@CurrentAuth() auth: AuthSession) {
    return this.engagement.favoriteIds(auth.user.id);
  }

  @Put('listings/:id/favorite')
  @HttpCode(204)
  async favorite(@CurrentAuth() auth: AuthSession, @Param('id', ParseUUIDPipe) id: string) {
    await this.engagement.setFavorite(auth.user.id, id, true);
  }

  @Delete('listings/:id/favorite')
  @HttpCode(204)
  async unfavorite(@CurrentAuth() auth: AuthSession, @Param('id', ParseUUIDPipe) id: string) {
    await this.engagement.setFavorite(auth.user.id, id, false);
  }

  @Get('me/recently-viewed')
  recentlyViewed(@CurrentAuth() auth: AuthSession) {
    return this.engagement.recentlyViewed(auth.user.id);
  }

  @Post('me/recently-viewed')
  @HttpCode(204)
  async recordViews(
    @CurrentAuth() auth: AuthSession,
    @Body({ schema: recentlyViewedSchema }) body: z.infer<typeof recentlyViewedSchema>,
  ) {
    await this.engagement.recordViews(auth.user.id, body.listingIds);
  }

  @Get('me/following')
  following(@CurrentAuth() auth: AuthSession) {
    return this.engagement.following(auth.user.id);
  }

  @Get('me/feed/following')
  feed(
    @CurrentAuth() auth: AuthSession,
    @Query('cursor') cursor?: string,
    @Query('limit') limit = '24',
  ) {
    if (cursor && !UUID.test(cursor)) throw new BadRequestException({ code: 'INVALID_CURSOR' });
    return this.engagement.followingFeed(auth.user.id, cursor, Number.parseInt(limit, 10) || 24);
  }
}
