import { createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { textPdf } from './pdf.js';
import {
  type CreateShipmentInput,
  InvalidShippingSignatureError,
  type Quote,
  type QuoteInput,
  type ServicePoint,
  type ShipmentLabel,
  type ShippingProvider,
  type TrackingProvider,
  type TrackingUpdate,
} from './ports.js';

export const MOCK_SIGNATURE_HEADER = 'x-mock-signature';

export function signMockWebhook(body: string, secret: string): string {
  return createHmac('sha256', secret).update(body).digest('hex');
}

export function mockWebhookBody(updates: TrackingUpdate[]): string {
  return JSON.stringify({ id: `mockevt_${randomUUID()}`, updates });
}

function verify(headers: Record<string, string | undefined>, raw: Buffer, secret: string) {
  const expected = Buffer.from(signMockWebhook(raw.toString('utf8'), secret), 'hex');
  const given = Buffer.from(headers[MOCK_SIGNATURE_HEADER] ?? '', 'hex');
  if (given.length !== expected.length || !timingSafeEqual(given, expected))
    throw new InvalidShippingSignatureError('Invalid mock webhook signature');
  const body = JSON.parse(raw.toString('utf8')) as { updates: TrackingUpdate[] };
  return body.updates.map((u) => ({ ...u, occurredAt: new Date(u.occurredAt) }));
}

const PRICES: Record<string, number> = { S: 450, M: 650, L: 1090, XL: 2190 };

/**
 * Development and e2e adapter (SPEC §7.3): placeholder PDF label, `MOCK-…` tracking, three fake
 * pickup points per CAP; tracking events are simulated by `POST /api/v1/dev/shipments/:id/advance`
 * through the real (HMAC-signed) webhook path.
 */
export class MockShippingProvider implements ShippingProvider, TrackingProvider {
  readonly name = 'mock' as const;

  constructor(private readonly secret: string) {}

  async quote(input: QuoteInput): Promise<Quote[]> {
    return [{ carrier: 'MOCK', service: 'standard', priceCents: PRICES[input.parcelSize] ?? 1000 }];
  }

  async createShipment(input: CreateShipmentInput): Promise<ShipmentLabel> {
    const trackingNumber = `MOCK-${randomBytes(5).toString('hex').toUpperCase()}`;
    return {
      providerShipmentId: `mock_${randomUUID()}`,
      carrier: 'MOCK',
      service: input.servicePointId ? 'service_point' : 'home',
      trackingNumber,
      trackingUrl: null,
      labelPdf: textPdf([
        'ETICHETTA DI PROVA',
        `Ordine ${input.reference} - pacco ${input.parcelSize}`,
        `Tracking ${trackingNumber}`,
        `Da: ${input.sender.name}, ${input.sender.cap} ${input.sender.city}`,
        `A: ${input.recipient.name}, ${input.recipient.cap} ${input.recipient.city}`,
        ...(input.servicePointId ? [`Punto di ritiro ${input.servicePointId}`] : []),
        'Non valida per la spedizione',
      ]),
      estimatedDeliveryAt: new Date(Date.now() + 3 * 86_400_000),
    };
  }

  async cancelShipment(): Promise<boolean> {
    return true;
  }

  createReturn(input: CreateShipmentInput): Promise<ShipmentLabel> {
    return this.createShipment({ ...input, reference: `${input.reference}-RESO` });
  }

  async listServicePoints(input: { cap: string }): Promise<ServicePoint[]> {
    return [1, 2, 3].map((n) => ({
      id: `mock-sp-${input.cap}-${n}`,
      name: ['Tabaccheria Centrale', 'Edicola della Stazione', 'Locker Supermercato'][
        n - 1
      ] as string,
      address: `Via di Prova ${n * 10}`,
      cap: input.cap,
      city: 'Comune di prova',
      carrier: 'MOCK',
    }));
  }

  async register(): Promise<void> {}

  parseWebhook(headers: Record<string, string | undefined>, rawBody: Buffer): TrackingUpdate[] {
    return verify(headers, rawBody, this.secret);
  }
}
