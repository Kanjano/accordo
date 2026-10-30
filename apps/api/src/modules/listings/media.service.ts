import { randomUUID } from 'node:crypto';
import type { PrismaClient } from '@accordo/db';
import type { ListingImageDto, UploadUrlResponse } from '@accordo/shared';
import { HeadObjectCommand, type S3Client } from '@aws-sdk/client-s3';
import { createPresignedPost } from '@aws-sdk/s3-presigned-post';
import { BadRequestException, ConflictException, Inject, Injectable } from '@nestjs/common';
import { ENV, type Env } from '../../config/env.js';
import { PRISMA, S3 } from '../platform/infra.providers.js';
import { writeOutbox } from '../platform/outbox.js';
import { RateLimitService } from '../platform/rate-limit.service.js';
import { SettingsService } from '../platform/settings.service.js';
import { ListingsService } from './listings.service.js';

const MAX_BYTES = 15 * 1024 * 1024;

/** SPEC §5.9: direct browser upload to a private temporary key, processing in the worker. */
/** The cover photo is part of the search document. */
const listingUpdated = (listingId: string) => ({
  aggregateType: 'Listing',
  aggregateId: listingId,
  type: 'listing.updated',
  payload: { listingId },
});

@Injectable()
export class MediaService {
  constructor(
    @Inject(ENV) private readonly env: Env,
    @Inject(PRISMA) private readonly db: PrismaClient,
    @Inject(S3) private readonly s3: S3Client,
    private readonly listings: ListingsService,
    private readonly settings: SettingsService,
    private readonly rateLimit: RateLimitService,
  ) {}

  async uploadUrl(userId: string, contentType: string): Promise<UploadUrlResponse> {
    await this.rateLimit.consume(`upload-url:${userId}`, 300, 24 * 3600);
    const key = `uploads/tmp/${userId}/${randomUUID()}`;
    const { url, fields } = await createPresignedPost(this.s3, {
      Bucket: this.env.S3_BUCKET_PRIVATE,
      Key: key,
      Conditions: [
        ['content-length-range', 1, MAX_BYTES],
        ['eq', '$Content-Type', contentType],
      ],
      Fields: { 'Content-Type': contentType },
      Expires: 600,
    });
    return { url, fields, key };
  }

  async attach(
    userId: string,
    listingId: string,
    tmpKey: string,
    altText?: string,
  ): Promise<ListingImageDto> {
    const listing = await this.listings.own(userId, listingId);
    if (
      !['DRAFT', 'ACTIVE', 'PAUSED', 'PENDING_REVIEW', 'EXPIRED', 'REJECTED'].includes(
        listing.status,
      )
    ) {
      throw new ConflictException({ code: 'LISTING_NOT_EDITABLE' });
    }
    // The key must be one this user uploaded (no attaching other people's objects).
    if (!tmpKey.startsWith(`uploads/tmp/${userId}/`))
      throw new BadRequestException({ code: 'INVALID_UPLOAD_KEY' });
    const { maxImages } = await this.settings.get('listings');
    if (listing.images.length >= maxImages)
      throw new ConflictException({ code: 'TOO_MANY_IMAGES' });
    try {
      const head = await this.s3.send(
        new HeadObjectCommand({ Bucket: this.env.S3_BUCKET_PRIVATE, Key: tmpKey }),
      );
      if ((head.ContentLength ?? 0) > MAX_BYTES) throw new Error('too large');
    } catch {
      throw new BadRequestException({ code: 'UPLOAD_NOT_FOUND' });
    }

    const image = await this.db.$transaction(async (tx) => {
      const created = await tx.listingImage.create({
        data: {
          listingId,
          storageKey: 'pending',
          width: 0,
          height: 0,
          position: listing.images.length,
          altText: altText ?? null,
        },
      });
      const storageKey = `listings/${listingId}/${created.id}`;
      await writeOutbox(tx, {
        aggregateType: 'ListingImage',
        aggregateId: created.id,
        type: 'media.uploaded',
        payload: { imageId: created.id, listingId, tmpKey, storageKey },
      });
      return tx.listingImage.update({ where: { id: created.id }, data: { storageKey } });
    });
    return {
      id: image.id,
      key: image.storageKey,
      width: 0,
      height: 0,
      position: image.position,
      altText: image.altText,
      blurDataUrl: null,
      ready: false,
    };
  }

  async reorder(userId: string, listingId: string, imageIds: string[]): Promise<void> {
    const listing = await this.listings.own(userId, listingId);
    const current = new Set(listing.images.map((i) => i.id));
    if (imageIds.length !== current.size || !imageIds.every((id) => current.has(id))) {
      throw new BadRequestException({ code: 'INVALID_IMAGE_ORDER' });
    }
    await this.db.$transaction(async (tx) => {
      for (const [position, id] of imageIds.entries())
        await tx.listingImage.update({ where: { id }, data: { position } });
      await writeOutbox(tx, listingUpdated(listingId));
    });
  }

  async remove(userId: string, listingId: string, imageId: string): Promise<void> {
    const listing = await this.listings.own(userId, listingId);
    const image = listing.images.find((i) => i.id === imageId);
    if (!image) throw new BadRequestException({ code: 'IMAGE_NOT_FOUND' });
    if (listing.status === 'ACTIVE' && listing.images.length === 1)
      throw new ConflictException({ code: 'LAST_IMAGE' });
    await this.db.$transaction(async (tx) => {
      await tx.listingImage.delete({ where: { id: imageId } });
      const rest = listing.images.filter((i) => i.id !== imageId);
      for (const [position, i] of rest.entries())
        await tx.listingImage.update({ where: { id: i.id }, data: { position } });
      await writeOutbox(
        tx,
        {
          aggregateType: 'ListingImage',
          aggregateId: imageId,
          type: 'media.deleted',
          payload: { storageKey: image.storageKey },
        },
        listingUpdated(listingId),
      );
    });
  }
}
