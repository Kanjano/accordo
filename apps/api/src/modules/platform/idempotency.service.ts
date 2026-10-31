import { createHash } from 'node:crypto';
import type { Prisma, PrismaClient } from '@accordo/db';
import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  UnprocessableEntityException,
} from '@nestjs/common';
import { PRISMA } from './infra.providers.js';

const TTL_MS = 24 * 3_600_000;

/**
 * `Idempotency-Key` for money-moving endpoints (SPEC §11.1): the first request with a key runs and
 * its response is stored; a repeat with the same body gets the same response, with another body a 422.
 */
@Injectable()
export class IdempotencyService {
  constructor(@Inject(PRISMA) private readonly db: PrismaClient) {}

  async run<T>(
    userId: string,
    key: string | undefined,
    endpoint: string,
    body: unknown,
    fn: () => Promise<T>,
  ): Promise<T> {
    if (!key || !/^[\w-]{8,100}$/.test(key))
      throw new BadRequestException({ code: 'IDEMPOTENCY_KEY_REQUIRED' });
    const requestHash = createHash('sha256')
      .update(`${endpoint}\n${JSON.stringify(body)}`)
      .digest('hex');
    const { count } = await this.db.idempotencyKey.createMany({
      data: { userId, key, endpoint, requestHash, expiresAt: new Date(Date.now() + TTL_MS) },
      skipDuplicates: true,
    });
    if (!count) {
      const existing = await this.db.idempotencyKey.findUniqueOrThrow({
        where: { userId_key: { userId, key } },
      });
      if (existing.requestHash !== requestHash)
        throw new UnprocessableEntityException({ code: 'IDEMPOTENCY_KEY_REUSED' });
      if (existing.responseStatus === null)
        throw new ConflictException({ code: 'IDEMPOTENCY_IN_PROGRESS' });
      return existing.responseBody as T;
    }
    try {
      const result = await fn();
      await this.db.idempotencyKey.update({
        where: { userId_key: { userId, key } },
        data: { responseStatus: 200, responseBody: result as Prisma.InputJsonValue },
      });
      return result;
    } catch (e) {
      // A failed attempt may be retried with the same key.
      await this.db.idempotencyKey.delete({ where: { userId_key: { userId, key } } });
      throw e;
    }
  }
}
