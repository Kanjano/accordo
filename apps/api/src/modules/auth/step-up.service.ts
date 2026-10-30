import { createHash, randomInt, timingSafeEqual } from 'node:crypto';
import type { PrismaClient } from '@accordo/db';
import type { StepUpInput, StepUpRequirement, StepUpStatus } from '@accordo/shared';
import { HttpException, HttpStatus, Inject, Injectable } from '@nestjs/common';
import { verifyPassword } from 'better-auth/crypto';
import type { Redis } from 'ioredis';
import { ENV, type Env } from '../../config/env.js';
import { Mailer } from '../notifications/email.provider.js';
import { PRISMA, REDIS } from '../platform/infra.providers.js';
import { RateLimitService } from '../platform/rate-limit.service.js';
import { DevicesService } from './devices.service.js';

export class StepUpRequiredException extends HttpException {
  constructor(requires: StepUpRequirement[]) {
    super(
      { code: 'STEP_UP_REQUIRED', detail: 'Recent authentication required', requires },
      HttpStatus.UNAUTHORIZED,
    );
  }
}

interface StepUpRecord {
  at: number;
  emailCode: boolean;
}
interface SessionRef {
  id: string;
  userId: string;
  createdAt: Date;
}

const sha = (v: string) => createHash('sha256').update(v).digest();

/**
 * Step-up (SPEC §3.1, §13.3): re-authentication if the last one is older than STEP_UP_MAX_AGE_MINUTES,
 * plus an emailed code when the device was first seen less than 24 hours ago.
 */
@Injectable()
export class StepUpService {
  constructor(
    @Inject(ENV) private readonly env: Env,
    @Inject(PRISMA) private readonly db: PrismaClient,
    @Inject(REDIS) private readonly redis: Redis,
    private readonly devices: DevicesService,
    private readonly mailer: Mailer,
    private readonly rateLimit: RateLimitService,
  ) {}

  private get maxAgeMs() {
    return this.env.STEP_UP_MAX_AGE_MINUTES * 60_000;
  }

  private async passwordHash(userId: string): Promise<string | null> {
    const account = await this.db.account.findFirst({
      where: { userId, providerId: 'credential' },
      select: { password: true },
    });
    return account?.password ?? null;
  }

  private async record(sessionId: string): Promise<StepUpRecord | null> {
    const raw = await this.redis.get(`stepup:${sessionId}`);
    return raw ? (JSON.parse(raw) as StepUpRecord) : null;
  }

  async status(
    session: SessionRef,
    deviceCookie: string | null,
    now = new Date(),
  ): Promise<StepUpStatus> {
    const [record, hasPassword, newDevice] = await Promise.all([
      this.record(session.id),
      this.passwordHash(session.userId).then(Boolean),
      this.devices.isNewDevice(session.userId, deviceCookie, now),
    ]);
    const fresh = (t: number) => now.getTime() - t <= this.maxAgeMs;
    const requires: StepUpRequirement[] = [];
    if (!fresh(Math.max(session.createdAt.getTime(), record?.at ?? 0)))
      requires.push(hasPassword ? 'password' : 'email_code');
    if (newDevice && !(record?.emailCode && fresh(record.at)) && !requires.includes('email_code'))
      requires.push('email_code');
    return { satisfied: requires.length === 0, requires, hasPassword };
  }

  async assert(session: SessionRef, deviceCookie: string | null): Promise<void> {
    const s = await this.status(session, deviceCookie);
    if (!s.satisfied) throw new StepUpRequiredException(s.requires);
  }

  /** Verifies the provided factors; they must cover every current requirement. */
  async verify(
    session: SessionRef,
    deviceCookie: string | null,
    input: StepUpInput,
  ): Promise<StepUpStatus> {
    await this.rateLimit.consume(`stepup:${session.userId}`, 10, 3600);
    const current = await this.status(session, deviceCookie);
    const invalid = () =>
      new HttpException(
        { code: 'STEP_UP_INVALID', detail: 'Invalid credentials' },
        HttpStatus.UNAUTHORIZED,
      );

    let passwordOk = false;
    if (input.password) {
      const hash = await this.passwordHash(session.userId);
      passwordOk = !!hash && (await verifyPassword({ hash, password: input.password }));
      if (!passwordOk) throw invalid();
    }
    let codeOk = false;
    if (input.emailCode) {
      codeOk = await this.consumeEmailCode(session.id, input.emailCode);
      if (!codeOk) throw invalid();
    }
    const missing = current.requires.filter((r) => (r === 'password' ? !passwordOk : !codeOk));
    if (missing.length) throw new StepUpRequiredException(missing);

    const prev = await this.record(session.id);
    const record: StepUpRecord = { at: Date.now(), emailCode: codeOk || !!prev?.emailCode };
    await this.redis.set(`stepup:${session.id}`, JSON.stringify(record), 'PX', this.maxAgeMs);
    return this.status(session, deviceCookie);
  }

  async sendEmailCode(session: SessionRef, user: { email: string; name: string }): Promise<void> {
    await this.rateLimit.consume(`stepup-code:${session.userId}`, 5, 3600);
    const code = randomInt(0, 1_000_000).toString().padStart(6, '0');
    await this.redis.set(
      `stepup-code:${session.id}`,
      JSON.stringify({ h: sha(code).toString('hex'), n: 0 }),
      'EX',
      600,
    );
    await this.mailer.send(user.email, 'stepUpCode', { name: user.name, code });
  }

  /** Constant-time check, at most 5 attempts per code. */
  private async consumeEmailCode(sessionId: string, code: string): Promise<boolean> {
    const key = `stepup-code:${sessionId}`;
    const raw = await this.redis.get(key);
    if (!raw) return false;
    const stored = JSON.parse(raw) as { h: string; n: number };
    const ok = timingSafeEqual(Buffer.from(stored.h, 'hex'), sha(code));
    if (ok || stored.n + 1 >= 5) await this.redis.del(key);
    else await this.redis.set(key, JSON.stringify({ ...stored, n: stored.n + 1 }), 'KEEPTTL');
    return ok;
  }
}
