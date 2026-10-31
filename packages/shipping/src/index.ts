import { MockShippingProvider } from './mock.js';
import type { ShippingProvider, TrackingProvider } from './ports.js';
import { SendcloudShippingProvider } from './sendcloud.js';

export * from './mock.js';
export * from './pdf.js';
export * from './ports.js';
export * from './sendcloud.js';

export interface ShippingEnv {
  SHIPPING_PROVIDER: 'mock' | 'sendcloud';
  SHIPPING_API_KEY?: string;
  SHIPPING_API_SECRET?: string;
  SHIPPING_WEBHOOK_SECRET?: string;
}

const mockSecret = (env: ShippingEnv) => env.SHIPPING_WEBHOOK_SECRET || 'mock-shipping-secret';

export function createShippingProvider(env: ShippingEnv): ShippingProvider {
  if (env.SHIPPING_PROVIDER === 'sendcloud') {
    if (!env.SHIPPING_API_KEY || !env.SHIPPING_API_SECRET)
      throw new Error('SHIPPING_PROVIDER=sendcloud needs SHIPPING_API_KEY and SHIPPING_API_SECRET');
    return new SendcloudShippingProvider(env.SHIPPING_API_KEY, env.SHIPPING_API_SECRET);
  }
  return new MockShippingProvider(mockSecret(env));
}

/** Tracking of self-shipped parcels: only the mock exists so far (ADR-0041). */
export function createTrackingProvider(env: ShippingEnv): TrackingProvider {
  return new MockShippingProvider(mockSecret(env));
}
