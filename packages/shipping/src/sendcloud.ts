import { createHmac, timingSafeEqual } from 'node:crypto';
import {
  type CreateShipmentInput,
  InvalidShippingSignatureError,
  type Quote,
  type QuoteInput,
  type ServicePoint,
  type ShipmentLabel,
  type ShipmentStatusCode,
  type ShippingProvider,
  type TrackingUpdate,
} from './ports.js';

export const SENDCLOUD_SIGNATURE_HEADER = 'sendcloud-signature';
const API = 'https://panel.sendcloud.sc/api/v2';
const SERVICE_POINTS = 'https://servicepoints.sendcloud.sc/api/v2';

/** Sendcloud parcel status id → our status (unknown ids are ignored). */
export const SENDCLOUD_STATUS: Record<number, ShipmentStatusCode> = {
  1: 'LABEL_CREATED', // announced
  1000: 'LABEL_CREATED', // ready to send
  3: 'IN_TRANSIT', // en route to sorting center
  4: 'IN_TRANSIT', // delivery delayed
  5: 'IN_TRANSIT', // sorted
  7: 'IN_TRANSIT', // being sorted
  22: 'IN_TRANSIT', // picked up by driver
  91: 'IN_TRANSIT', // parcel en route
  92: 'OUT_FOR_DELIVERY', // driver en route
  12: 'AVAILABLE_FOR_PICKUP', // awaiting customer pickup
  11: 'DELIVERED',
  93: 'DELIVERED', // collected by customer
  8: 'EXCEPTION', // delivery attempt failed
  15: 'EXCEPTION', // error collecting
  62: 'EXCEPTION', // unable to deliver
  80: 'EXCEPTION', // unable to deliver
  1002: 'EXCEPTION', // announcement failed
  1999: 'CANCELLED',
  2000: 'CANCELLED',
  2001: 'CANCELLED',
};

interface SendcloudParcel {
  id: number;
  tracking_number: string;
  tracking_url?: string | null;
  carrier?: { code: string };
  shipment?: { id: number; name: string };
  label?: { label_printer?: string; normal_printer?: string[] };
  status?: { id: number; message: string };
}

type Fetch = typeof fetch;

/**
 * Sendcloud (SPEC §7.3), Basic auth with the public and secret keys. Behind the
 * `SHIPPING_PROVIDER=sendcloud` flag: built and contract-tested on sample payloads, not yet run
 * against a real account (ADR-0041).
 */
export class SendcloudShippingProvider implements ShippingProvider {
  readonly name = 'sendcloud' as const;
  private readonly auth: string;

  constructor(
    publicKey: string,
    private readonly secretKey: string,
    private readonly fetchFn: Fetch = fetch,
  ) {
    this.auth = `Basic ${Buffer.from(`${publicKey}:${secretKey}`).toString('base64')}`;
  }

  private async call<T>(url: string, init: RequestInit = {}): Promise<T> {
    const res = await this.fetchFn(url, {
      ...init,
      headers: { authorization: this.auth, 'content-type': 'application/json', ...init.headers },
    });
    if (!res.ok) throw new Error(`Sendcloud ${init.method ?? 'GET'} ${url}: HTTP ${res.status}`);
    return (await res.json()) as T;
  }

  /** Cheapest Italian method able to carry the weight (to a service point when requested). */
  private async method(weightKg: number, servicePoint: boolean) {
    const { shipping_methods: methods } = await this.call<{
      shipping_methods: Array<{
        id: number;
        name: string;
        carrier: string;
        min_weight: string;
        max_weight: string;
        service_point_input: string;
        countries: Array<{ iso_2: string; price: number }>;
      }>;
    }>(`${API}/shipping_methods?to_country=IT${servicePoint ? '&service_point_id=1' : ''}`);
    const fitting = methods
      .filter(
        (m) =>
          Number(m.min_weight) <= weightKg &&
          weightKg <= Number(m.max_weight) &&
          (m.service_point_input === 'required') === servicePoint &&
          m.countries.some((c) => c.iso_2 === 'IT'),
      )
      .map((m) => ({ ...m, price: m.countries.find((c) => c.iso_2 === 'IT')?.price ?? 0 }))
      .sort((a, b) => a.price - b.price);
    if (!fitting[0]) throw new Error(`No Sendcloud method for ${weightKg} kg`);
    return fitting;
  }

  async quote(input: QuoteInput): Promise<Quote[]> {
    const methods = await this.method(input.weightKg, !!input.servicePoint);
    return methods.map((m) => ({
      carrier: m.carrier,
      service: m.name,
      priceCents: Math.round(m.price * 100),
    }));
  }

  private parcelBody(input: CreateShipmentInput, methodId: number, isReturn: boolean) {
    return {
      parcel: {
        name: input.recipient.name,
        address: input.recipient.line1,
        address_2: input.recipient.line2 ?? '',
        city: input.recipient.city,
        postal_code: input.recipient.cap,
        country: 'IT',
        telephone: input.recipient.phone,
        email: input.recipient.email ?? undefined,
        from_name: input.sender.name,
        from_address_1: input.sender.line1,
        from_address_2: input.sender.line2 ?? '',
        from_city: input.sender.city,
        from_postal_code: input.sender.cap,
        from_country: 'IT',
        from_telephone: input.sender.phone,
        weight: input.weightKg.toFixed(3),
        order_number: input.reference,
        request_label: true,
        is_return: isReturn,
        shipment: { id: methodId },
        ...(input.servicePointId ? { to_service_point: Number(input.servicePointId) } : {}),
      },
    };
  }

  private async create(input: CreateShipmentInput, isReturn: boolean): Promise<ShipmentLabel> {
    const [method] = await this.method(input.weightKg, !!input.servicePointId);
    const { parcel } = await this.call<{ parcel: SendcloudParcel }>(`${API}/parcels`, {
      method: 'POST',
      body: JSON.stringify(this.parcelBody(input, (method as { id: number }).id, isReturn)),
    });
    const labelUrl = parcel.label?.label_printer ?? parcel.label?.normal_printer?.[0];
    if (!labelUrl) throw new Error(`Sendcloud parcel ${parcel.id} has no label`);
    const pdf = await this.fetchFn(labelUrl, { headers: { authorization: this.auth } });
    if (!pdf.ok) throw new Error(`Sendcloud label ${parcel.id}: HTTP ${pdf.status}`);
    return {
      providerShipmentId: String(parcel.id),
      carrier: parcel.carrier?.code ?? 'sendcloud',
      service: parcel.shipment?.name ?? null,
      trackingNumber: parcel.tracking_number,
      trackingUrl: parcel.tracking_url ?? null,
      labelPdf: Buffer.from(await pdf.arrayBuffer()),
      estimatedDeliveryAt: null,
    };
  }

  createShipment(input: CreateShipmentInput) {
    return this.create(input, false);
  }

  createReturn(input: CreateShipmentInput) {
    return this.create(input, true);
  }

  async cancelShipment(providerShipmentId: string): Promise<boolean> {
    const res = await this.fetchFn(`${API}/parcels/${providerShipmentId}/cancel`, {
      method: 'POST',
      headers: { authorization: this.auth },
    });
    // 200 cancelled, 202 cancellation queued; 410 already handed to the carrier.
    if (res.status === 200 || res.status === 202) return true;
    if (res.status === 410 || res.status === 400) return false;
    throw new Error(`Sendcloud cancel ${providerShipmentId}: HTTP ${res.status}`);
  }

  async listServicePoints(input: { cap: string; carrier?: string }): Promise<ServicePoint[]> {
    const points = await this.call<
      Array<{
        id: number;
        name: string;
        street: string;
        house_number: string;
        postal_code: string;
        city: string;
        carrier: string;
      }>
    >(
      `${SERVICE_POINTS}/service-points?country=IT&postal_code=${encodeURIComponent(input.cap)}${
        input.carrier ? `&carrier=${encodeURIComponent(input.carrier)}` : ''
      }`,
    );
    return points.slice(0, 10).map((p) => ({
      id: String(p.id),
      name: p.name,
      address: `${p.street} ${p.house_number}`.trim(),
      cap: p.postal_code,
      city: p.city,
      carrier: p.carrier,
    }));
  }

  /** `Sendcloud-Signature`: HMAC-SHA256 of the raw body with the secret key. */
  parseWebhook(headers: Record<string, string | undefined>, rawBody: Buffer): TrackingUpdate[] {
    const expected = createHmac('sha256', this.secretKey).update(rawBody).digest();
    const given = Buffer.from(headers[SENDCLOUD_SIGNATURE_HEADER] ?? '', 'hex');
    if (given.length !== expected.length || !timingSafeEqual(given, expected))
      throw new InvalidShippingSignatureError('Invalid Sendcloud signature');
    const body = JSON.parse(rawBody.toString('utf8')) as {
      action: string;
      timestamp: number;
      parcel?: SendcloudParcel;
    };
    if (body.action !== 'parcel_status_changed' || !body.parcel?.status) return [];
    const status = SENDCLOUD_STATUS[body.parcel.status.id];
    return status
      ? [
          {
            shipmentId: String(body.parcel.id),
            status,
            occurredAt: new Date(body.timestamp),
            description: body.parcel.status.message,
          },
        ]
      : [];
  }
}
