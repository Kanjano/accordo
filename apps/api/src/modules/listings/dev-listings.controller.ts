import type { PrismaClient } from '@accordo/db';
import { generateShortId } from '@accordo/domain';
import {
  Controller,
  HttpCode,
  Inject,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import { ENV, type Env } from '../../config/env.js';
import { CurrentAuth } from '../auth/auth.decorators.js';
import type { AuthSession } from '../auth/auth.factory.js';
import { PRISMA } from '../platform/infra.providers.js';

/**
 * Development only: an ACTIVE copy of one of the seller's listings (same photos), so the e2e
 * purchase journeys never run out of demo stock. 404 in production.
 */
@Controller('dev/listings')
export class DevListingsController {
  constructor(
    @Inject(PRISMA) private readonly db: PrismaClient,
    @Inject(ENV) private readonly env: Env,
  ) {}

  @Post(':id/clone')
  @HttpCode(201)
  async clone(@CurrentAuth() auth: AuthSession, @Param('id', ParseUUIDPipe) id: string) {
    if (this.env.NODE_ENV === 'production') throw new NotFoundException();
    const l = await this.db.listing.findFirst({
      where: { id, sellerId: auth.user.id },
      include: { images: true },
    });
    if (!l) throw new NotFoundException();
    const now = new Date();
    const {
      id: _id,
      shortId: _shortId,
      images,
      createdAt: _c,
      updatedAt: _u,
      soldAt: _s,
      deletedAt: _d,
      attributes,
      ...rest
    } = l;
    const copy = await this.db.listing.create({
      data: {
        ...rest,
        attributes: attributes ?? {},
        shortId: generateShortId(),
        status: 'ACTIVE',
        publishedAt: now,
        bumpedAt: now,
        expiresAt: new Date(now.getTime() + 60 * 86_400_000),
        viewsCount: 0,
        favoritesCount: 0,
        images: {
          create: images.map(({ id: _i, listingId: _l, createdAt: _ic, ...img }) => img),
        },
        priceHistory: { create: { priceCents: l.priceCents, changedAt: now } },
      },
    });
    await this.db.outboxEvent.create({
      data: {
        aggregateType: 'Listing',
        aggregateId: copy.id,
        type: 'listing.published',
        payload: { listingId: copy.id },
      },
    });
    return { id: copy.id, slug: copy.slug, shortId: copy.shortId };
  }
}
