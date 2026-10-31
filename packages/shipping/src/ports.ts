/** SPEC §7.2. No module calls the shipping provider directly: everything goes through these ports. */
export type ShipmentStatusCode =
  | 'LABEL_CREATED'
  | 'IN_TRANSIT'
  | 'OUT_FOR_DELIVERY'
  | 'AVAILABLE_FOR_PICKUP'
  | 'DELIVERED'
  | 'EXCEPTION'
  | 'RETURNED_TO_SENDER'
  | 'CANCELLED';

export type ParcelSizeCode = 'S' | 'M' | 'L' | 'XL';

export interface PostalAddress {
  name: string;
  line1: string;
  line2?: string | null;
  cap: string;
  city: string;
  provincia: string;
  country: 'IT';
  phone: string;
  email?: string | null;
}

export interface QuoteInput {
  from: { cap: string };
  to: { cap: string };
  parcelSize: ParcelSizeCode;
  weightKg: number;
  servicePoint?: boolean;
}

export interface Quote {
  carrier: string;
  service: string;
  priceCents: number;
}

export interface CreateShipmentInput {
  /** Order number, printed on the label. */
  reference: string;
  sender: PostalAddress;
  recipient: PostalAddress;
  servicePointId?: string | null;
  parcelSize: ParcelSizeCode;
  weightKg: number;
}
export type CreateReturnInput = CreateShipmentInput;

export interface ShipmentLabel {
  providerShipmentId: string;
  carrier: string;
  service: string | null;
  trackingNumber: string;
  trackingUrl: string | null;
  /** PDF bytes, stored in the private bucket (never served directly). */
  labelPdf: Buffer;
  estimatedDeliveryAt: Date | null;
}

export interface ServicePoint {
  id: string;
  name: string;
  address: string;
  cap: string;
  city: string;
  carrier: string;
}

export interface TrackingUpdate {
  /** Provider shipment id (Shipment.providerShipmentId). */
  shipmentId: string;
  status: ShipmentStatusCode;
  occurredAt: Date;
  description?: string;
  location?: string;
}

export class InvalidShippingSignatureError extends Error {}

export interface ShippingProvider {
  readonly name: 'mock' | 'sendcloud' | 'shippypro';
  quote(input: QuoteInput): Promise<Quote[]>;
  createShipment(input: CreateShipmentInput): Promise<ShipmentLabel>;
  /** false when the carrier no longer allows it (label already used). */
  cancelShipment(providerShipmentId: string): Promise<boolean>;
  createReturn(input: CreateReturnInput): Promise<ShipmentLabel>;
  listServicePoints(input: { cap: string; carrier?: string }): Promise<ServicePoint[]>;
  /** Verifies the signature on the raw body. */
  parseWebhook(headers: Record<string, string | undefined>, rawBody: Buffer): TrackingUpdate[];
}

/** Tracking of self-shipped parcels (SPEC §6.5). */
export interface TrackingProvider {
  readonly name: string;
  register(input: { carrier: string; trackingNumber: string; shipmentId: string }): Promise<void>;
  parseWebhook(headers: Record<string, string | undefined>, rawBody: Buffer): TrackingUpdate[];
}
