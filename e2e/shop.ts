import { type APIRequestContext, expect, type Page } from '@playwright/test';
import { API } from './helpers';

export const SELLER = 'negozio@accordo.local';
export const BUYER = 'utente@accordo.local';
export const headers = { origin: 'http://localhost:3000' };

export interface Detail {
  id: string;
  slug: string;
  shortId: string;
  status: string;
  protectedPaymentEnabled: boolean;
  handDeliveryEnabled: boolean;
  shippingSelf: boolean;
  selfShippingPriceCents: number | null;
  integratedShippingPriceCents: number | null;
}

/** An active listing of the demo shop that can be bought with the given delivery method. */
export async function findListing(
  request: APIRequestContext,
  method: 'hand' | 'self' | 'integrated',
) {
  const fits = (l: Detail) =>
    l.protectedPaymentEnabled &&
    (method === 'hand'
      ? l.handDeliveryEnabled
      : method === 'self'
        ? l.shippingSelf && !!l.selfShippingPriceCents
        : !!l.integratedShippingPriceCents);
  // The seller's own list includes sold listings, usable as templates.
  const mine = (await (await request.get(`${API}/api/v1/me/listings`)).json()) as Array<{
    shortId: string;
    status: string;
  }>;
  let template: Detail | null = null;
  for (const item of mine.filter((x) => x.status === 'ACTIVE' || x.status === 'SOLD')) {
    const l = (await (
      await request.get(`${API}/api/v1/listings/${item.shortId}`)
    ).json()) as Detail;
    if (fits(l)) {
      template = l;
      break;
    }
  }
  // Always a fresh ACTIVE copy (development endpoint): parallel tests never compete for the same
  // listing and repeated runs don't use up the demo stock.
  if (!template) throw new Error('No suitable demo listing: re-seed the demo data');
  const copy = await (
    await request.post(`${API}/api/v1/dev/listings/${template.id}/clone`, { headers })
  ).json();
  return (await (await request.get(`${API}/api/v1/listings/${copy.shortId}`)).json()) as Detail;
}

/** Buys through the listing page and the (fake provider) checkout; returns the order page path. */
export async function buy(page: Page, l: Detail, method: string) {
  await page.goto(`/annuncio/${l.slug}-${l.shortId}`);
  const box = page.getByRole('region', { name: 'Compra con pagamento protetto' });
  await box.getByRole('radio', { name: new RegExp(method) }).check();
  await box.getByRole('button', { name: 'Compra', exact: true }).click();
  await expect(page).toHaveURL(/\/checkout\/[0-9a-f-]{36}$/);
  await page.getByRole('button', { name: 'Paga (simulazione)' }).click();
  // The fake webhook goes through the outbox and the worker, like Stripe's would.
  await expect(page).toHaveURL(/\/account\/acquisti\/[0-9a-f-]{36}$/, { timeout: 20_000 });
  return new URL(page.url()).pathname.split('/').at(-1) as string;
}
