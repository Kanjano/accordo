import { describe, expect, it } from 'vitest';
import {
  MOCK_SIGNATURE_HEADER,
  MockShippingProvider,
  mockWebhookBody,
  signMockWebhook,
} from './mock.js';
import { InvalidShippingSignatureError } from './ports.js';

describe('MockShippingProvider', () => {
  const mock = new MockShippingProvider('secret');

  it('creates a placeholder PDF label with a MOCK tracking number', async () => {
    const a = {
      name: 'A',
      line1: 'Via 1',
      cap: '20121',
      city: 'Milano',
      provincia: 'MI',
      country: 'IT' as const,
      phone: '1',
    };
    const label = await mock.createShipment({
      reference: '26-X',
      sender: a,
      recipient: a,
      parcelSize: 'M',
      weightKg: 5,
    });
    expect(label.trackingNumber).toMatch(/^MOCK-[0-9A-F]{10}$/);
    const pdf = label.labelPdf.toString('latin1');
    expect(pdf.startsWith('%PDF-1.4')).toBe(true);
    expect(pdf).toContain(label.trackingNumber);
    expect(pdf.trimEnd().endsWith('%%EOF')).toBe(true);
  });

  it('accepts only HMAC-signed webhooks', () => {
    const body = mockWebhookBody([
      { shipmentId: 'mock_1', status: 'IN_TRANSIT', occurredAt: new Date(0) },
    ]);
    const raw = Buffer.from(body);
    expect(
      mock.parseWebhook({ [MOCK_SIGNATURE_HEADER]: signMockWebhook(body, 'secret') }, raw),
    ).toEqual([{ shipmentId: 'mock_1', status: 'IN_TRANSIT', occurredAt: new Date(0) }]);
    expect(() =>
      mock.parseWebhook({ [MOCK_SIGNATURE_HEADER]: signMockWebhook(body, 'x') }, raw),
    ).toThrow(InvalidShippingSignatureError);
  });
});
