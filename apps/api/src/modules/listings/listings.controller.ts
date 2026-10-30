import {
  imageAttachSchema,
  imageOrderSchema,
  LISTING_STATUSES,
  type ListingCreate,
  type ListingStatus,
  type ListingUpdate,
  listingCreateSchema,
  listingUpdateSchema,
  uploadUrlSchema,
} from '@accordo/shared';
import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import type { z } from 'zod';
import { CurrentAuth, Public } from '../auth/auth.decorators.js';
import type { AuthSession } from '../auth/auth.factory.js';
import { ListingsService } from './listings.service.js';
import { MediaService } from './media.service.js';

@Controller()
export class ListingsController {
  constructor(
    private readonly listings: ListingsService,
    private readonly media: MediaService,
  ) {}

  @Post('listings')
  create(
    @CurrentAuth() auth: AuthSession,
    @Body({ schema: listingCreateSchema }) body: ListingCreate,
  ) {
    return this.listings.create(auth.user.id, body);
  }

  @Get('listings/:idOrShortId')
  @Public()
  get(@Param('idOrShortId') id: string, @CurrentAuth() auth: AuthSession | null) {
    return this.listings.detail(id, auth?.user.id ?? null);
  }

  @Get('listings/:idOrShortId/similar')
  @Public()
  similar(@Param('idOrShortId') id: string) {
    return this.listings.similar(id);
  }

  @Patch('listings/:id')
  update(
    @CurrentAuth() auth: AuthSession,
    @Param('id', ParseUUIDPipe) id: string,
    @Body({ schema: listingUpdateSchema }) body: ListingUpdate,
  ) {
    return this.listings.update(auth.user.id, id, body);
  }

  @Post('listings/:id/publish')
  @HttpCode(200)
  publish(@CurrentAuth() auth: AuthSession, @Param('id', ParseUUIDPipe) id: string) {
    return this.listings.publish(auth.user.id, id);
  }

  @Delete('listings/:id')
  @HttpCode(204)
  async remove(@CurrentAuth() auth: AuthSession, @Param('id', ParseUUIDPipe) id: string) {
    await this.listings.remove(auth.user.id, id);
  }

  @Get('me/listings')
  mine(@CurrentAuth() auth: AuthSession, @Query('status') status?: string) {
    if (status && !LISTING_STATUSES.includes(status as ListingStatus))
      throw new BadRequestException({ code: 'INVALID_STATUS' });
    return this.listings.mine(auth.user.id, status as ListingStatus | undefined);
  }

  @Post('media/upload-url')
  uploadUrl(
    @CurrentAuth() auth: AuthSession,
    @Body({ schema: uploadUrlSchema }) body: z.infer<typeof uploadUrlSchema>,
  ) {
    return this.media.uploadUrl(auth.user.id, body.contentType);
  }

  @Post('listings/:id/images')
  attach(
    @CurrentAuth() auth: AuthSession,
    @Param('id', ParseUUIDPipe) id: string,
    @Body({ schema: imageAttachSchema }) body: z.infer<typeof imageAttachSchema>,
  ) {
    return this.media.attach(auth.user.id, id, body.key, body.altText);
  }

  @Patch('listings/:id/images/order')
  @HttpCode(204)
  async reorder(
    @CurrentAuth() auth: AuthSession,
    @Param('id', ParseUUIDPipe) id: string,
    @Body({ schema: imageOrderSchema }) body: z.infer<typeof imageOrderSchema>,
  ) {
    await this.media.reorder(auth.user.id, id, body.imageIds);
  }

  @Delete('listings/:id/images/:imageId')
  @HttpCode(204)
  async removeImage(
    @CurrentAuth() auth: AuthSession,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('imageId', ParseUUIDPipe) imageId: string,
  ) {
    await this.media.remove(auth.user.id, id, imageId);
  }

  /** Declared last: the generic ':action' segment must not shadow the image routes. */
  @Post('listings/:id/:action')
  @HttpCode(200)
  lifecycle(
    @CurrentAuth() auth: AuthSession,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('action') action: string,
  ) {
    const u = auth.user.id;
    switch (action) {
      case 'pause':
        return this.listings.pause(u, id);
      case 'resume':
        return this.listings.resume(u, id);
      case 'renew':
        return this.listings.renew(u, id);
      case 'bump':
        return this.listings.bump(u, id);
      case 'mark-sold':
        return this.listings.markSold(u, id);
      default:
        throw new BadRequestException({ code: 'UNKNOWN_ACTION' });
    }
  }
}
