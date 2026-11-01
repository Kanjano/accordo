import {
  type ShopApply,
  type ShopStatus,
  type ShopUpdate,
  shopApplySchema,
  shopMediaSchema,
  shopRejectSchema,
  shopUpdateSchema,
} from '@accordo/shared';
import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import type { z } from 'zod';
import { CurrentAuth, Public, Roles } from '../auth/auth.decorators.js';
import type { AuthSession } from '../auth/auth.factory.js';
import { ShopsService } from './shops.service.js';

type Auth = AuthSession;
const STAFF = ['admin', 'moderator', 'support'];
const STATUSES: ShopStatus[] = ['PENDING', 'VERIFIED', 'REJECTED'];

@Controller()
export class ShopsController {
  constructor(private readonly shops: ShopsService) {}

  @Get('shops')
  @Public()
  directory(@Query() q: { region?: string; q?: string; page?: string }) {
    return this.shops.directory({
      region: /^[a-z0-9-]{1,80}$/.test(q.region ?? '') ? q.region : undefined,
      q: q.q,
      page: Number(q.page) || 1,
    });
  }

  @Get('shops/:slug')
  @Public()
  storefront(@Param('slug') slug: string) {
    return this.shops.storefront(slug);
  }

  @Get('me/shop')
  mine(@CurrentAuth() auth: Auth) {
    return this.shops.mine(auth.user.id);
  }

  @Post('shops')
  apply(@CurrentAuth() auth: Auth, @Body({ schema: shopApplySchema }) body: ShopApply) {
    return this.shops.apply(auth.user.id, body);
  }

  @Patch('me/shop')
  update(@CurrentAuth() auth: Auth, @Body({ schema: shopUpdateSchema }) body: ShopUpdate) {
    return this.shops.update(auth.user.id, body);
  }

  @Post('me/shop/media')
  @HttpCode(202)
  async media(
    @CurrentAuth() auth: Auth,
    @Body({ schema: shopMediaSchema }) body: z.infer<typeof shopMediaSchema>,
  ) {
    await this.shops.media(auth.user.id, body.kind, body.key);
  }

  // ───────────── Staff (SPEC §3.10) ─────────────

  @Get('admin/shops')
  @Roles(...STAFF)
  adminList(@Query('status') status?: string) {
    return this.shops.adminList(
      STATUSES.includes(status as ShopStatus) ? (status as ShopStatus) : 'PENDING',
    );
  }

  @Post('admin/shops/:id/verify')
  @Roles(...STAFF)
  @HttpCode(204)
  async verify(@CurrentAuth() auth: Auth, @Param('id', ParseUUIDPipe) id: string) {
    await this.shops.verify(auth.user.id, id);
  }

  @Post('admin/shops/:id/reject')
  @Roles(...STAFF)
  @HttpCode(204)
  async reject(
    @CurrentAuth() auth: Auth,
    @Param('id', ParseUUIDPipe) id: string,
    @Body({ schema: shopRejectSchema }) body: z.infer<typeof shopRejectSchema>,
  ) {
    await this.shops.reject(auth.user.id, id, body.reason);
  }
}
