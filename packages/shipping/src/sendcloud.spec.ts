import { createHmac } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { InvalidShippingSignatureError } from './ports.js';
import { SendcloudShippingProvider } from './sendcloud.js';

const address = {
  name: 'Mario Rossi',
  line1: 'Via Roma 1',
  cap: '20121',
  city: 'Milano',
  provincia: 'MI',
  country: 'IT' as const,
  phone: '3331234567',
};

/** Sample payloads shaped like Sendcloud's API v2 documentation (contract tests, ADR-0041). */
const METHODS = {
  shipping_methods: [
    {
      id: 8,
      name: 'Unstamped letter',
      carrier: 'sendcloud',
      min_weight: '0.001',
      max_weight: '1.001',
      service_point_input: 'none',
      countries: [{ iso_2: 'IT', price: 0 }],
    },
    {
      id: 1343,
      name: 'BRT Express 0-20kg',
      carrier: 'brt',
      min_weight: '0.001',
      max_weight: '20.001',
      service_point_input: 'none',
      countries: [{ iso_2: 'IT', price: 7.2 }],
    },
    {
      id: 1344,
      name: 'GLS 0-30kg',
      carrier: 'gls_it',
      min_weight: '0.001',
      max_weight: '30.001',
      service_point_input: 'none',
      countries: [{ iso_2: 'IT', price: 9.5 }],
    },
    {
      id: 2001,
      name: 'InPost Locker',
      carrier: 'inpost_it',
      min_weight: '0.001',
      max_weight: '25.001',
      service_point_input: 'required',
      countries: [{ iso_2: 'IT', price: 4.1 }],
    },
  ],
};
const PARCEL = {
  parcel: {
    id: 123456789,
    tracking_number: 'BRT0001234567',
    tracking_url: 'https://tracking.sendcloud.sc/forward?carrier=brt&code=BRT0001234567',
    carrier: { code: 'brt' },
    shipment: { id: 1343, name: 'BRT Express 0-20kg' },
    label: { label_printer: 'https://panel.sendcloud.sc/api/v2/labels/label_printer/123456789' },
    status: { id: 1000, message: 'Ready to send' },
  },
};

function fakeFetch() {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const fn = vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    if (url.includes('/shipping_methods')) return Response.json(METHODS);
    if (url.endsWith('/parcels')) return Response.json(PARCEL);
    if (url.includes('/labels/')) return new Response(Buffer.from('%PDF-1.4 label'));
    if (url.includes('/cancel'))
      return new Response('{}', { status: url.includes('999') ? 410 : 200 });
    if (url.includes('service-points'))
      return Response.json([
        {
          id: 10,
          name: 'Edicola',
          street: 'Via Po',
          house_number: '3',
          postal_code: '20121',
          city: 'Milano',
          carrier: 'inpost_it',
        },
      ]);
    return new Response('not found', { status: 404 });
  });
  return { fn: fn as unknown as typeof fetch, calls };
}

describe('SendcloudShippingProvider (contract)', () => {
  it('creates a parcel with the cheapest method that fits and downloads the label', async () => {
    const { fn, calls } = fakeFetch();
    const sc = new SendcloudShippingProvider('pub', 'sec', fn);
    const label = await sc.createShipment({
      reference: '26-ABC123',
      sender: address,
      recipient: { ...address, name: 'Lucia Bianchi', cap: '00184', city: 'Roma' },
      parcelSize: 'L',
      weightKg: 15,
    });
    expect(label).toMatchObject({
      providerShipmentId: '123456789',
      carrier: 'brt',
      trackingNumber: 'BRT0001234567',
    });
    expect(label.labelPdf.toString()).toContain('%PDF');
    const create = calls.find((c) => c.url.endsWith('/parcels'));
    const body = JSON.parse(String(create?.init?.body)).parcel;
    expect(body).toMatchObject({
      name: 'Lucia Bianchi',
      postal_code: '00184',
      from_postal_code: '20121',
      country: 'IT',
      weight: '15.000',
      request_label: true,
      is_return: false,
      order_number: '26-ABC123',
      shipment: { id: 1343 },
    });
    expect(create?.init?.headers).toMatchObject({
      authorization: `Basic ${Buffer.from('pub:sec').toString('base64')}`,
    });
  });

  it('uses a service-point method and passes the point id', async () => {
    const { fn, calls } = fakeFetch();
    const sc = new SendcloudShippingProvider('pub', 'sec', fn);
    await sc.createReturn({
      reference: 'R',
      sender: address,
      recipient: address,
      servicePointId: '10',
      parcelSize: 'S',
      weightKg: 2,
    });
    const body = JSON.parse(
      String(calls.find((c) => c.url.endsWith('/parcels'))?.init?.body),
    ).parcel;
    expect(body).toMatchObject({ shipment: { id: 2001 }, to_service_point: 10, is_return: true });
    expect((await sc.listServicePoints({ cap: '20121' }))[0]).toMatchObject({
      id: '10',
      address: 'Via Po 3',
    });
  });

  it('reports whether a label can still be cancelled', async () => {
    const sc = new SendcloudShippingProvider('pub', 'sec', fakeFetch().fn);
    expect(await sc.cancelShipment('123')).toBe(true);
    expect(await sc.cancelShipment('999')).toBe(false);
  });

  it('verifies Sendcloud-Signature and maps the parcel status', () => {
    const sc = new SendcloudShippingProvider('pub', 'sec');
    const raw = Buffer.from(
      JSON.stringify({
        action: 'parcel_status_changed',
        timestamp: 1_793_000_000_000,
        parcel: { id: 123456789, tracking_number: 'X', status: { id: 11, message: 'Delivered' } },
      }),
    );
    const sig = createHmac('sha256', 'sec').update(raw).digest('hex');
    expect(sc.parseWebhook({ 'sendcloud-signature': sig }, raw)).toEqual([
      {
        shipmentId: '123456789',
        status: 'DELIVERED',
        occurredAt: new Date(1_793_000_000_000),
        description: 'Delivered',
      },
    ]);
    expect(() => sc.parseWebhook({ 'sendcloud-signature': '00'.repeat(32) }, raw)).toThrow(
      InvalidShippingSignatureError,
    );
    expect(() => sc.parseWebhook({}, raw)).toThrow(InvalidShippingSignatureError);
    const other = Buffer.from(JSON.stringify({ action: 'integration_updated', timestamp: 1 }));
    expect(
      sc.parseWebhook(
        { 'sendcloud-signature': createHmac('sha256', 'sec').update(other).digest('hex') },
        other,
      ),
    ).toEqual([]);
  });
});
