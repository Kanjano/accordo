import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import type { PrismaClient } from '@accordo/db';
import { Inject, Injectable } from '@nestjs/common';
import { ENV, type Env } from '../../config/env.js';
import { PRISMA } from '../platform/infra.providers.js';

/** Long-lived signed cookie identifying a browser (SPEC §13.3). Stored only as a hash. */
export const DEVICE_COOKIE = 'accordo_device';
export const DEVICE_COOKIE_MAX_AGE = 400 * 24 * 3600;
const NEW_DEVICE_MS = 24 * 3600 * 1000;

export function readCookie(cookieHeader: string | null | undefined, name: string): string | null {
  for (const part of (cookieHeader ?? '').split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return decodeURIComponent(v.join('='));
  }
  return null;
}

/** "93.41.12.0/24" or the first 4 IPv6 groups: enough for alerts, not a full address. */
export function ipPrefix(ip: string | null | undefined): string | null {
  if (!ip) return null;
  if (ip.includes('.')) return `${ip.split('.').slice(0, 3).join('.')}.0/24`;
  return `${ip.split(':').slice(0, 4).join(':')}::/64`;
}

@Injectable()
export class DevicesService {
  constructor(
    @Inject(ENV) private readonly env: Env,
    @Inject(PRISMA) private readonly db: PrismaClient,
  ) {}

  private signature(id: string): string {
    return createHmac('sha256', this.env.DEVICE_COOKIE_SECRET).update(id).digest('base64url');
  }

  /** Returns the device id when the cookie value carries a valid signature. */
  verifyCookie(value: string | null): string | null {
    const [id, sig] = value?.split('.') ?? [];
    if (!id || !sig) return null;
    const expected = Buffer.from(this.signature(id));
    const actual = Buffer.from(sig);
    return expected.length === actual.length && timingSafeEqual(expected, actual) ? id : null;
  }

  private hash(id: string): string {
    return createHash('sha256').update(id).digest('hex');
  }

  /**
   * Called on every new session. Unknown or missing device → new KnownDevice row and a fresh cookie.
   * `alert` is true when the user already had other devices (first ever login does not alert).
   */
  async recordLogin(
    userId: string,
    cookieValue: string | null,
    meta: { userAgent?: string | null; ip?: string | null },
  ): Promise<{ cookie: string | null; alert: boolean }> {
    const id = this.verifyCookie(cookieValue);
    if (id) {
      const updated = await this.db.knownDevice.updateMany({
        where: { userId, deviceIdHash: this.hash(id) },
        data: {
          lastSeenAt: new Date(),
          userAgent: meta.userAgent ?? null,
          ipPrefix: ipPrefix(meta.ip),
        },
      });
      if (updated.count) return { cookie: null, alert: false };
    }
    const deviceId = id ?? randomBytes(24).toString('base64url');
    const others = await this.db.knownDevice.count({ where: { userId } });
    await this.db.knownDevice.create({
      data: {
        userId,
        deviceIdHash: this.hash(deviceId),
        userAgent: meta.userAgent ?? null,
        ipPrefix: ipPrefix(meta.ip),
      },
    });
    return { cookie: id ? null : `${deviceId}.${this.signature(deviceId)}`, alert: others > 0 };
  }

  /** True when the device is unknown or was first seen less than 24 hours ago. */
  async isNewDevice(
    userId: string,
    cookieValue: string | null,
    now = new Date(),
  ): Promise<boolean> {
    const id = this.verifyCookie(cookieValue);
    if (!id) return true;
    const device = await this.db.knownDevice.findUnique({
      where: { userId_deviceIdHash: { userId, deviceIdHash: this.hash(id) } },
    });
    return !device || now.getTime() - device.firstSeenAt.getTime() < NEW_DEVICE_MS;
  }
}
