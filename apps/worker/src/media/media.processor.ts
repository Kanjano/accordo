import type { PrismaClient } from '@accordo/db';
import { isSimilarImage } from '@accordo/domain';
import {
  DeleteObjectCommand,
  DeleteObjectsCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  type S3Client,
} from '@aws-sdk/client-s3';
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Inject, Logger } from '@nestjs/common';
import type { Job } from 'bullmq';
import { ENV, type Env } from '../env.js';
import { PRISMA, S3 } from '../infra.js';
import { QUEUES } from '../queues.js';
import { type ProcessedImage, processImage, UnsupportedImageError } from './pipeline.js';

interface UploadedPayload {
  imageId: string;
  listingId: string;
  tmpKey: string;
  storageKey: string;
}

interface ShopPayload {
  shopId: string;
  kind: 'logo' | 'cover';
  tmpKey: string;
  storageKey: string;
}

@Processor(QUEUES.media, { concurrency: 4 })
export class MediaProcessor extends WorkerHost {
  private readonly logger = new Logger(MediaProcessor.name);

  constructor(
    @Inject(ENV) private readonly env: Env,
    @Inject(PRISMA) private readonly db: PrismaClient,
    @Inject(S3) private readonly s3: S3Client,
  ) {
    super();
  }

  async process(job: Job): Promise<void> {
    if (job.name === 'media.uploaded') return this.uploaded(job.data as UploadedPayload);
    if (job.name === 'media.shop_uploaded') return this.shopUploaded(job.data as ShopPayload);
    if (job.name === 'media.deleted')
      return this.deletePrefix((job.data as { storageKey: string }).storageKey);
  }

  private async readTmp(tmpKey: string) {
    const object = await this.s3.send(
      new GetObjectCommand({ Bucket: this.env.S3_BUCKET_PRIVATE, Key: tmpKey }),
    );
    return Buffer.from(
      await (object.Body as { transformToByteArray(): Promise<Uint8Array> }).transformToByteArray(),
    );
  }

  private async putVariants(storageKey: string, variants: ProcessedImage['variants']) {
    for (const v of variants) {
      await this.s3.send(
        new PutObjectCommand({
          Bucket: this.env.S3_BUCKET_PUBLIC,
          Key: `${storageKey}/${v.name}`,
          Body: v.body,
          ContentType: v.contentType,
          CacheControl: 'public, max-age=31536000, immutable',
        }),
      );
    }
  }

  /** Shop logo or cover: same pipeline as listing photos, then the old image is deleted. */
  private async shopUploaded({ shopId, kind, tmpKey, storageKey }: ShopPayload) {
    let processed: ProcessedImage;
    try {
      processed = await processImage(await this.readTmp(tmpKey));
    } catch (e) {
      if (!(e instanceof UnsupportedImageError) && !String(e).includes('Input')) throw e;
      this.logger.warn(`Rejected shop upload ${tmpKey}: ${String(e)}`);
      return this.deleteTmp(tmpKey);
    }
    await this.putVariants(storageKey, processed.variants);
    const shop = await this.db.shop.findUnique({
      where: { id: shopId },
      select: { logoKey: true, coverKey: true },
    });
    if (!shop) {
      await this.deletePrefix(storageKey);
      return this.deleteTmp(tmpKey);
    }
    const field = kind === 'logo' ? 'logoKey' : 'coverKey';
    await this.db.shop.update({ where: { id: shopId }, data: { [field]: storageKey } });
    if (shop[field]) await this.deletePrefix(shop[field]);
    await this.deleteTmp(tmpKey);
  }

  private async uploaded({ imageId, listingId, tmpKey, storageKey }: UploadedPayload) {
    const image = await this.db.listingImage.findUnique({ where: { id: imageId } });
    if (!image) return this.deleteTmp(tmpKey); // removed by the seller meanwhile
    let processed: ProcessedImage;
    try {
      processed = await processImage(await this.readTmp(tmpKey));
    } catch (e) {
      if (!(e instanceof UnsupportedImageError) && !String(e).includes('Input')) throw e;
      // Not an image we accept: drop it instead of retrying forever.
      this.logger.warn(`Rejected upload ${tmpKey}: ${String(e)}`);
      await this.db.listingImage.deleteMany({ where: { id: imageId } });
      return this.deleteTmp(tmpKey);
    }

    await this.putVariants(storageKey, processed.variants);
    await this.db.listingImage.updateMany({
      where: { id: imageId },
      data: {
        width: processed.width,
        height: processed.height,
        blurDataUrl: processed.blurDataUrl,
        phash: processed.phash,
      },
    });
    await this.db.outboxEvent.create({
      data: {
        aggregateType: 'Listing',
        aggregateId: listingId,
        type: 'listing.updated',
        payload: { listingId },
      },
    });
    await this.deleteTmp(tmpKey);
    await this.checkReuse(listingId, processed.phash);
  }

  /** New photo on a live listing that matches another seller's photo → back to review (SPEC §13.5). */
  private async checkReuse(listingId: string, phash: string) {
    const listing = await this.db.listing.findUnique({
      where: { id: listingId },
      select: { status: true, sellerId: true, categoryId: true },
    });
    if (listing?.status !== 'ACTIVE') return;
    const others = await this.db.listingImage.findMany({
      where: {
        phash: { not: null },
        listing: {
          sellerId: { not: listing.sellerId },
          categoryId: listing.categoryId,
          status: { not: 'DRAFT' },
        },
      },
      select: { phash: true },
      distinct: ['phash'],
      take: 5000,
    });
    if (!others.some((o) => isSimilarImage(phash, o.phash as string))) return;
    await this.db.$transaction([
      this.db.listing.update({ where: { id: listingId }, data: { status: 'PENDING_REVIEW' } }),
      this.db.outboxEvent.create({
        data: {
          aggregateType: 'Listing',
          aggregateId: listingId,
          type: 'listing.review_pending',
          payload: { listingId, sellerId: listing.sellerId, reasons: ['REUSED_IMAGES'] },
        },
      }),
    ]);
  }

  private async deleteTmp(key: string) {
    await this.s3
      .send(new DeleteObjectCommand({ Bucket: this.env.S3_BUCKET_PRIVATE, Key: key }))
      .catch(() => undefined);
  }

  private async deletePrefix(storageKey: string) {
    const listed = await this.s3.send(
      new ListObjectsV2Command({ Bucket: this.env.S3_BUCKET_PUBLIC, Prefix: `${storageKey}/` }),
    );
    const objects = (listed.Contents ?? []).map((o) => ({ Key: o.Key as string }));
    if (objects.length)
      await this.s3.send(
        new DeleteObjectsCommand({
          Bucket: this.env.S3_BUCKET_PUBLIC,
          Delete: { Objects: objects },
        }),
      );
  }
}
