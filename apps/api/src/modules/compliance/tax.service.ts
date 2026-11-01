import type { PrismaClient } from '@accordo/db';
import {
  dac7Assessment,
  isIban,
  isValidCodiceFiscale,
  isValidPartitaIva,
  yearQuarter,
} from '@accordo/domain';
import type { AdminDac7Row, TaxProfileInput, TaxProfileView, TaxStatus } from '@accordo/shared';
import {
  Inject,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { PRISMA } from '../platform/infra.providers.js';
import { writeOutbox } from '../platform/outbox.js';
import { SettingsService } from '../platform/settings.service.js';
import { FieldCrypto } from './field-crypto.js';

const mask = (v: string, keep = 4) =>
  `${'•'.repeat(Math.max(0, v.length - keep))}${v.slice(-keep)}`;
const REMINDER_TYPE = 'dac7.request';

/** SPEC §14.4: seller tax data (encrypted), thresholds, reminders and the yearly export. */
@Injectable()
export class TaxService {
  constructor(
    @Inject(PRISMA) private readonly db: PrismaClient,
    private readonly crypto: FieldCrypto,
    private readonly settings: SettingsService,
  ) {}

  private async yearTotals(userId: string, year: number) {
    const agg = await this.db.dac7Period.aggregate({
      where: { userId, year },
      _sum: { activitiesCount: true, considerationCents: true },
    });
    return {
      activities: agg._sum.activitiesCount ?? 0,
      considerationCents: Number(agg._sum.considerationCents ?? 0),
    };
  }

  async status(userId: string, now = new Date()): Promise<TaxStatus> {
    const { year } = yearQuarter(now);
    const totals = await this.yearTotals(userId, year);
    const a = dac7Assessment(totals, await this.settings.get('dac7'));
    const p = await this.db.taxProfile.findUnique({ where: { userId } });
    const profile: TaxProfileView | null = p
      ? {
          legalName: p.legalName,
          taxIdMasked: mask(this.crypto.decrypt(p.taxIdEnc)),
          birthDateSet: !!p.birthDateEnc,
          vatNumber: p.vatNumber,
          addressLine: p.addressLine,
          cap: p.cap,
          city: p.city,
          ibanMasked: p.ibanEnc ? mask(this.crypto.decrypt(p.ibanEnc)) : null,
          collectedAt: p.collectedAt.toISOString(),
        }
      : null;
    return {
      required: a.requestProfile,
      profile,
      year: { ...totals, reportable: a.reportable },
    };
  }

  async upsert(userId: string, input: TaxProfileInput): Promise<TaxStatus> {
    const taxIdOk =
      input.taxId.length === 16
        ? isValidCodiceFiscale(input.taxId)
        : isValidPartitaIva(input.taxId);
    if (!taxIdOk) throw new UnprocessableEntityException({ code: 'TAX_ID_INVALID' });
    if (input.vatNumber && !isValidPartitaIva(input.vatNumber))
      throw new UnprocessableEntityException({ code: 'VAT_INVALID' });
    if (!isIban(input.iban)) throw new UnprocessableEntityException({ code: 'IBAN_INVALID' });
    const data = {
      legalName: input.legalName,
      taxIdEnc: this.crypto.encrypt(input.taxId),
      taxIdHash: this.crypto.blindIndex(input.taxId),
      birthDateEnc: this.crypto.encrypt(input.birthDate),
      vatNumber: input.vatNumber ?? null,
      addressLine: input.addressLine,
      cap: input.cap,
      city: input.city,
      ibanEnc: this.crypto.encrypt(input.iban),
      collectedAt: new Date(),
    };
    await this.db.$transaction([
      this.db.taxProfile.upsert({ where: { userId }, create: { userId, ...data }, update: data }),
      // Never the values themselves in the audit log.
      this.db.auditLog.create({
        data: {
          actorId: userId,
          action: 'tax_profile.saved',
          entityType: 'TaxProfile',
          entityId: userId,
        },
      }),
      // Payouts held for missing DAC7 data can go.
      this.db.outboxEvent.create({
        data: {
          aggregateType: 'User',
          aggregateId: userId,
          type: 'dac7.profile_saved',
          payload: { sellerId: userId },
        },
      }),
    ]);
    return this.status(userId);
  }

  // ───────────── Staff ─────────────

  async adminList(year: number): Promise<AdminDac7Row[]> {
    const settings = await this.settings.get('dac7');
    const groups = await this.db.dac7Period.groupBy({
      by: ['userId'],
      where: { year },
      _sum: { activitiesCount: true, considerationCents: true, feesCents: true },
    });
    const users = await this.db.user.findMany({
      where: { id: { in: groups.map((g) => g.userId) } },
      select: { id: true, email: true, username: true, taxProfile: { select: { userId: true } } },
    });
    const byId = new Map(users.map((u) => [u.id, u]));
    const reminders = await this.db.notification.groupBy({
      by: ['userId'],
      where: {
        type: REMINDER_TYPE,
        userId: { in: groups.map((g) => g.userId) },
        createdAt: { gte: new Date(Date.UTC(year, 0, 1)) },
      },
      _count: true,
      _max: { createdAt: true },
    });
    const rem = new Map(reminders.map((r) => [r.userId, r]));
    return groups
      .map((g) => {
        const totals = {
          activities: g._sum.activitiesCount ?? 0,
          considerationCents: Number(g._sum.considerationCents ?? 0),
        };
        const a = dac7Assessment(totals, settings);
        const u = byId.get(g.userId);
        return {
          userId: g.userId,
          email: u?.email ?? '',
          username: u?.username ?? null,
          ...totals,
          feesCents: Number(g._sum.feesCents ?? 0),
          ...a,
          hasProfile: !!u?.taxProfile,
          remindersSent: rem.get(g.userId)?._count ?? 0,
          lastReminderAt: rem.get(g.userId)?._max.createdAt?.toISOString() ?? null,
        };
      })
      .filter((r) => r.requestProfile)
      .sort((a, b) => b.considerationCents - a.considerationCents);
  }

  async remind(staffId: string, userId: string) {
    if (!(await this.db.user.count({ where: { id: userId } }))) throw new NotFoundException();
    await this.db.$transaction(async (tx) => {
      await writeOutbox(tx, {
        aggregateType: 'User',
        aggregateId: userId,
        type: 'dac7.reminder',
        payload: { userId },
      });
      await tx.auditLog.create({
        data: { actorId: staffId, action: 'dac7.remind', entityType: 'User', entityId: userId },
      });
    });
  }

  /** Full CSV for the accountant (official AdE layout later, SPEC §14.4). Decrypts: admin only. */
  async exportCsv(staffId: string, year: number): Promise<string> {
    const rows = (await this.adminList(year)).filter((r) => r.reportable);
    const periods = await this.db.dac7Period.findMany({
      where: { year, userId: { in: rows.map((r) => r.userId) } },
    });
    const profiles = await this.db.taxProfile.findMany({
      where: { userId: { in: rows.map((r) => r.userId) } },
    });
    const profile = new Map(profiles.map((p) => [p.userId, p]));
    const cell = (v: unknown) => {
      const s = v == null ? '' : String(v);
      // CSV injection: spreadsheet formulas never start a cell.
      const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
      return /[";\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
    };
    const header = [
      'user_id',
      'email',
      'legal_name',
      'tax_id',
      'birth_date',
      'vat_number',
      'address',
      'cap',
      'city',
      'iban',
      'activities',
      'consideration_eur',
      'fees_eur',
      ...[1, 2, 3, 4].flatMap((q) => [
        `q${q}_activities`,
        `q${q}_consideration_eur`,
        `q${q}_fees_eur`,
      ]),
    ];
    const eur = (c: number | bigint) => (Number(c) / 100).toFixed(2);
    const lines = rows.map((r) => {
      const p = profile.get(r.userId);
      const dec = (v: string | null | undefined) => (v ? this.crypto.decrypt(v) : '');
      const q = (n: number) => periods.find((x) => x.userId === r.userId && x.quarter === n);
      return [
        r.userId,
        r.email,
        p?.legalName,
        dec(p?.taxIdEnc),
        dec(p?.birthDateEnc),
        p?.vatNumber,
        p?.addressLine,
        p?.cap,
        p?.city,
        dec(p?.ibanEnc),
        r.activities,
        eur(r.considerationCents),
        eur(r.feesCents),
        ...[1, 2, 3, 4].flatMap((n) => {
          const x = q(n);
          return [x?.activitiesCount ?? 0, eur(x?.considerationCents ?? 0), eur(x?.feesCents ?? 0)];
        }),
      ]
        .map(cell)
        .join(';');
    });
    await this.db.auditLog.create({
      data: {
        actorId: staffId,
        action: 'dac7.export',
        entityType: 'Dac7Period',
        metadata: { year, sellers: rows.length },
      },
    });
    return `${header.join(';')}\n${lines.join('\n')}\n`;
  }
}
