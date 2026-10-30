import { createPrismaClient, type PrismaClient } from '@accordo/db';
import { createEmailProvider, type EmailProvider } from '@accordo/emails';
import { S3Client } from '@aws-sdk/client-s3';
import { Global, Inject, Module, type OnApplicationShutdown } from '@nestjs/common';
import { ENV, type Env, parseEnv } from './env.js';

export const PRISMA = Symbol('PRISMA');
export const S3 = Symbol('S3');
export const EMAIL = Symbol('EMAIL');

@Global()
@Module({
  providers: [
    { provide: ENV, useFactory: () => parseEnv() },
    {
      provide: PRISMA,
      inject: [ENV],
      useFactory: (env: Env) => createPrismaClient(env.DATABASE_URL),
    },
    {
      provide: S3,
      inject: [ENV],
      useFactory: (env: Env) =>
        new S3Client({
          endpoint: env.S3_ENDPOINT,
          region: env.S3_REGION,
          forcePathStyle: env.S3_FORCE_PATH_STYLE,
          credentials: {
            accessKeyId: env.S3_ACCESS_KEY_ID,
            secretAccessKey: env.S3_SECRET_ACCESS_KEY,
          },
        }),
    },
    { provide: EMAIL, inject: [ENV], useFactory: (env: Env) => createEmailProvider(env) },
  ],
  exports: [ENV, PRISMA, S3, EMAIL],
})
export class InfraModule implements OnApplicationShutdown {
  constructor(
    @Inject(PRISMA) private readonly db: PrismaClient,
    @Inject(S3) private readonly s3: S3Client,
  ) {}

  async onApplicationShutdown() {
    await this.db.$disconnect();
    this.s3.destroy();
  }
}

export type { EmailProvider };
