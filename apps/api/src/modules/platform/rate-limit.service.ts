import { HttpException, HttpStatus, Inject, Injectable } from '@nestjs/common';
import type { Redis } from 'ioredis';
import { ENV, type Env } from '../../config/env.js';
import { REDIS } from './infra.providers.js';

/** Fixed-window counters on Valkey (SPEC §13.2). */
@Injectable()
export class RateLimitService {
  constructor(
    @Inject(REDIS) private readonly redis: Redis,
    @Inject(ENV) private readonly env: Env,
  ) {}

  /** Counts a hit; returns the remaining budget, or throws 429 RATE_LIMITED when exhausted. */
  async consume(key: string, limit: number, windowSeconds: number): Promise<number> {
    // RATE_LIMIT_ENABLED=false only in tests/e2e, where every run creates new resources.
    if (!this.env.RATE_LIMIT_ENABLED) return limit;
    const redisKey = `rl:${key}`;
    const [[, count], [, ttl]] = (await this.redis.multi().incr(redisKey).ttl(redisKey).exec()) as [
      [null, number],
      [null, number],
    ];
    if (ttl < 0) await this.redis.expire(redisKey, windowSeconds);
    if (count > limit) {
      throw new HttpException(
        { code: 'RATE_LIMITED', detail: `Retry in ${ttl > 0 ? ttl : windowSeconds}s` },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    return limit - count;
  }
}
