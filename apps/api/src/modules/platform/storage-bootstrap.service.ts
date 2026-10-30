import {
  CreateBucketCommand,
  HeadBucketCommand,
  PutBucketPolicyCommand,
  type S3Client,
} from '@aws-sdk/client-s3';
import { Inject, Injectable, Logger, type OnApplicationBootstrap } from '@nestjs/common';
import { ENV, type Env } from '../../config/env.js';
import { S3 } from './infra.providers.js';

/** Development only: creates the media buckets on startup; the public one gets anonymous read. */
@Injectable()
export class StorageBootstrapService implements OnApplicationBootstrap {
  private readonly logger = new Logger(StorageBootstrapService.name);

  constructor(
    @Inject(ENV) private readonly env: Env,
    @Inject(S3) private readonly s3: S3Client,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    if (this.env.NODE_ENV !== 'development') return;
    try {
      await this.ensureBucket(this.env.S3_BUCKET_PRIVATE);
      if (await this.ensureBucket(this.env.S3_BUCKET_PUBLIC)) {
        await this.s3.send(
          new PutBucketPolicyCommand({
            Bucket: this.env.S3_BUCKET_PUBLIC,
            Policy: JSON.stringify({
              Version: '2012-10-17',
              Statement: [
                {
                  Effect: 'Allow',
                  Principal: '*',
                  Action: ['s3:GetObject'],
                  Resource: [`arn:aws:s3:::${this.env.S3_BUCKET_PUBLIC}/*`],
                },
              ],
            }),
          }),
        );
      }
    } catch (e) {
      // Storage down must not block the API: /health/ready reports it.
      this.logger.warn(`Bucket bootstrap skipped: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  /** Returns true when the bucket was created. */
  private async ensureBucket(Bucket: string): Promise<boolean> {
    try {
      await this.s3.send(new HeadBucketCommand({ Bucket }));
      return false;
    } catch {
      await this.s3.send(new CreateBucketCommand({ Bucket }));
      this.logger.log(`Created bucket ${Bucket}`);
      return true;
    }
  }
}
