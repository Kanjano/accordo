import type { PrismaClient } from '@accordo/db';
import { type Dac7Settings, dac7Assessment, yearQuarter } from '@accordo/domain';
import { DeleteObjectsCommand, ListObjectsV2Command, type S3Client } from '@aws-sdk/client-s3';
import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Inject, Injectable, Logger, type OnApplicationBootstrap } from '@nestjs/common';
import type { Job, Queue } from 'bullmq';
import { ENV, type Env } from './env.js';
import { PRISMA, S3 } from './infra.js';
import { Notifier } from './notifications/notifier.js';
import { QUEUES } from './queues.js';

const DAY = 86_400_000;
export const DAC7_REQUEST = 'dac7.request';

interface RetentionSettings {
  messagesMonths: number;
  auditLogMonths: number;
  notificationsMonths: number;
  tmpUploadsHours: number;
}

async function setting<T>(db: PrismaClient, key: string): Promise<T> {
  const row = await db.platformSetting.findUnique({ where: { key } });
  if (!row) throw new Error(`Missing platform setting "${key}"`);
  return row.value as T;
}

const monthsAgo = (now: Date, months: number) => {
  const d = new Date(now);
  d.setUTCMonth(d.getUTCMonth() - months);
  return d;
};

async function remindersThisYear(db: PrismaClient, userId: string, year: number) {
  return db.notification.findMany({
    where: { userId, type: DAC7_REQUEST, createdAt: { gte: new Date(Date.UTC(year, 0, 1)) } },
    select: { createdAt: true },
    orderBy: { createdAt: 'desc' },
  });
}

/**
 * SPEC §14.4: with `blockPayoutsWithoutProfile` (off by default, to confirm with the accountant), a
 * reportable seller who ignored every reminder gets no new payouts until the data arrives.
 */
export async function dac7PayoutsBlocked(db: PrismaClient, userId: string, now = new Date()) {
  // Missing setting = feature off (its default), never a failed payout.
  const s = (await db.platformSetting.findUnique({ where: { key: 'dac7' } }))?.value as
    | Dac7Settings
    | undefined;
  if (!s?.blockPayoutsWithoutProfile) return false;
  if (await db.taxProfile.count({ where: { userId } })) return false;
  const { year } = yearQuarter(now);
  const agg = await db.dac7Period.aggregate({
    where: { userId, year },
    _sum: { activitiesCount: true, considerationCents: true },
  });
  const { reportable } = dac7Assessment(
    {
      activities: agg._sum.activitiesCount ?? 0,
      considerationCents: Number(agg._sum.considerationCents ?? 0),
    },
    s,
  );
  return reportable && (await remindersThisYear(db, userId, year)).length >= s.maxReminders;
}

@Injectable()
export class ComplianceScheduler implements OnApplicationBootstrap {
  constructor(@InjectQueue(QUEUES.compliance) private readonly queue: Queue) {}

  async onApplicationBootstrap() {
    const tz = 'Europe/Rome';
    await this.queue.upsertJobScheduler(
      'dac7-nightly',
      { pattern: '30 2 * * *', tz },
      { name: 'dac7' },
    );
    await this.queue.upsertJobScheduler(
      'retention-nightly',
      { pattern: '30 3 * * *', tz },
      { name: 'retention' },
    );
    await this.queue.upsertJobScheduler(
      'sanctions-hourly',
      { pattern: '5 * * * *', tz },
      { name: 'sanctions' },
    );
  }
}

/** DAC7 monitoring, data retention (SPEC §14.5) and expiry of suspensions. */
@Processor(QUEUES.compliance)
export class ComplianceProcessor extends WorkerHost {
  private readonly logger = new Logger(ComplianceProcessor.name);

  constructor(
    @Inject(PRISMA) private readonly db: PrismaClient,
    @Inject(S3) private readonly s3: S3Client,
    @Inject(ENV) private readonly env: Env,
    private readonly notifier: Notifier,
  ) {
    super();
  }

  async process(job: Job) {
    const now = new Date();
    if (job.name === 'dac7') return this.dac7(now);
    if (job.name === 'retention') return this.retention(now);
    if (job.name === 'sanctions') return this.expireSuspensions(now);
    if (job.name === 'dac7.reminder') {
      // Manual reminder from the back office: always sent, counted with the automatic ones.
      const { userId } = job.data as { userId: string };
      const s = await setting<Dac7Settings>(this.db, 'dac7');
      const previous = await remindersThisYear(this.db, userId, yearQuarter(now).year);
      return this.requestTaxData(
        userId,
        previous.length + 1,
        Math.max(s.maxReminders, previous.length + 1),
      );
    }
  }

  // ───────────── DAC7 ─────────────

  /**
   * Quarter totals from completed protected-payment orders (consideration = what the seller earns
   * before platform fees; one activity per order), then threshold checks and reminders.
   */
  async dac7(now: Date) {
    const { year } = yearQuarter(now);
    // In January the previous year is still being finalised.
    const years =
      yearQuarter(new Date(now.getTime() - 31 * DAY)).year < year ? [year - 1, year] : [year];
    for (const y of years) {
      const orders = await this.db.order.findMany({
        where: {
          status: 'COMPLETED',
          completedAt: {
            gte: new Date(Date.UTC(y - 1, 11, 31)),
            lt: new Date(Date.UTC(y + 1, 0, 2)),
          },
        },
        select: { sellerId: true, completedAt: true, sellerNetCents: true, sellerFeeCents: true },
      });
      const totals = new Map<string, { activities: number; consideration: number; fees: number }>();
      for (const o of orders) {
        const yq = yearQuarter(o.completedAt as Date);
        if (yq.year !== y) continue;
        const key = `${o.sellerId}|${yq.quarter}`;
        const t = totals.get(key) ?? { activities: 0, consideration: 0, fees: 0 };
        t.activities++;
        t.consideration += o.sellerNetCents + o.sellerFeeCents;
        t.fees += o.sellerFeeCents;
        totals.set(key, t);
      }
      for (const [key, t] of totals) {
        const [userId, q] = key.split('|') as [string, string];
        const data = {
          activitiesCount: t.activities,
          considerationCents: BigInt(t.consideration),
          feesCents: BigInt(t.fees),
        };
        await this.db.dac7Period.upsert({
          where: { userId_year_quarter: { userId, year: y, quarter: Number(q) } },
          create: { userId, year: y, quarter: Number(q), ...data },
          update: data,
        });
      }
    }
    return { reminders: await this.dac7Reminders(now, year) };
  }

  private async dac7Reminders(now: Date, year: number) {
    const s = await setting<Dac7Settings>(this.db, 'dac7');
    const groups = await this.db.dac7Period.groupBy({
      by: ['userId'],
      where: { year },
      _sum: { activitiesCount: true, considerationCents: true },
    });
    let sent = 0;
    for (const g of groups) {
      const a = dac7Assessment(
        {
          activities: g._sum.activitiesCount ?? 0,
          considerationCents: Number(g._sum.considerationCents ?? 0),
        },
        s,
      );
      if (!a.requestProfile || (await this.db.taxProfile.count({ where: { userId: g.userId } })))
        continue;
      const previous = await remindersThisYear(this.db, g.userId, year);
      const last = previous[0]?.createdAt;
      if (previous.length >= s.maxReminders) continue;
      if (last && now.getTime() - last.getTime() < s.reminderEveryDays * DAY) continue;
      await this.requestTaxData(g.userId, previous.length + 1, s.maxReminders);
      sent++;
    }
    return sent;
  }

  async requestTaxData(userId: string, n: number, of: number) {
    await this.notifier.notify({
      userId,
      preference: 'tax.dac7',
      mandatory: true,
      type: DAC7_REQUEST,
      title: 'Ci servono i tuoi dati fiscali (DAC7)',
      body: `Per legge le piattaforme comunicano all'Agenzia delle Entrate i dati dei venditori che superano 30 vendite o 2.000 € in un anno. Ti stai avvicinando a una delle soglie: inserisci i tuoi dati fiscali dall'area personale (richiesta ${n} di ${of}).`,
      path: '/account/dati-fiscali',
      cta: 'Inserisci i dati fiscali',
      data: { reminder: n },
    });
  }

  // ───────────── Retention (SPEC §14.5) ─────────────

  async retention(now: Date) {
    const r = await setting<RetentionSettings>(this.db, 'retention');
    // Messages: conversations silent for longer than the retention period, except those tied to an
    // open dispute or an open report (they are evidence).
    const stale = await this.db.conversation.findMany({
      where: { lastMessageAt: { lt: monthsAgo(now, r.messagesMonths) } },
      select: { id: true, listingId: true, buyerId: true, sellerId: true },
      take: 1000,
    });
    let messages = 0;
    for (const c of stale) {
      const [dispute, report] = await Promise.all([
        this.db.dispute.count({
          where: {
            status: { notIn: ['RESOLVED', 'WITHDRAWN'] },
            order: { listingId: c.listingId, buyerId: c.buyerId, sellerId: c.sellerId },
          },
        }),
        this.db.report.count({
          where: {
            targetType: 'MESSAGE',
            status: { in: ['OPEN', 'IN_REVIEW'] },
            targetId: {
              in: (
                await this.db.message.findMany({
                  where: { conversationId: c.id },
                  select: { id: true },
                })
              ).map((m) => m.id),
            },
          },
        }),
      ]);
      if (dispute || report) continue;
      messages += (await this.db.message.deleteMany({ where: { conversationId: c.id } })).count;
    }
    const notifications = await this.db.notification.deleteMany({
      where: { createdAt: { lt: monthsAgo(now, r.notificationsMonths) } },
    });
    // The application role cannot DELETE audit rows: a SECURITY DEFINER function purges them, and
    // the append-only trigger refuses rows younger than 2 years (ADR-0051).
    const [{ n }] = await this.db.$queryRaw<[{ n: number }]>`
      SELECT purge_audit_log(${monthsAgo(now, Math.max(r.auditLogMonths, 25))}) AS n`;
    const audit = { count: n };
    const idempotency = await this.db.idempotencyKey.deleteMany({
      where: { expiresAt: { lt: now } },
    });
    const sessions = await this.db.session.deleteMany({ where: { expiresAt: { lt: now } } });
    const uploads = await this.purgeTmpUploads(
      new Date(now.getTime() - r.tmpUploadsHours * 3_600_000),
    );
    const result = {
      messages,
      notifications: notifications.count,
      audit: audit.count,
      idempotency: idempotency.count,
      sessions: sessions.count,
      uploads,
    };
    this.logger.log(`retention: ${JSON.stringify(result)}`);
    return result;
  }

  /** Abandoned browser uploads (photos never attached) in the private bucket. */
  private async purgeTmpUploads(before: Date) {
    let deleted = 0;
    let token: string | undefined;
    try {
      do {
        const page = await this.s3.send(
          new ListObjectsV2Command({
            Bucket: this.env.S3_BUCKET_PRIVATE,
            Prefix: 'uploads/tmp/',
            ContinuationToken: token,
          }),
        );
        const old = (page.Contents ?? []).filter((o) => o.LastModified && o.LastModified < before);
        if (old.length) {
          await this.s3.send(
            new DeleteObjectsCommand({
              Bucket: this.env.S3_BUCKET_PRIVATE,
              Delete: { Objects: old.map((o) => ({ Key: o.Key as string })) },
            }),
          );
          deleted += old.length;
        }
        token = page.IsTruncated ? page.NextContinuationToken : undefined;
      } while (token);
    } catch (e) {
      this.logger.warn(`tmp uploads purge failed: ${String(e)}`);
    }
    return deleted;
  }

  // ───────────── Sanctions ─────────────

  async expireSuspensions(now: Date) {
    const expired = await this.db.user.findMany({
      where: { status: 'SUSPENDED', banExpires: { lt: now } },
      select: { id: true },
    });
    for (const u of expired) {
      await this.db.$transaction([
        this.db.user.update({
          where: { id: u.id },
          data: { status: 'ACTIVE', banned: false, banReason: null, banExpires: null },
        }),
        this.db.auditLog.create({
          data: { action: 'user.suspension_expired', entityType: 'User', entityId: u.id },
        }),
      ]);
    }
    return { reinstated: expired.length };
  }
}
