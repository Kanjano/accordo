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
  const me = await (await request.get(`${API}/api/v1/me`)).json();
  let cursor = '';
  for (;;) {
    const page = await (
      await request.get(
        `${API}/api/v1/users/${me.username}/listings?limit=50${cursor ? `&cursor=${cursor}` : ''}`,
      )
    ).json();
    for (const item of page.items as Array<{ shortId: string }>) {
      const l = (await (
        await request.get(`${API}/api/v1/listings/${item.shortId}`)
      ).json()) as Detail;
      if (
        l.status === 'ACTIVE' &&
        l.protectedPaymentEnabled &&
        (method === 'hand'
          ? l.handDeliveryEnabled
          : method === 'self'
            ? l.shippingSelf && !!l.selfShippingPriceCents
            : !!l.integratedShippingPriceCents)
      )
        return l;
    }
    if (!page.nextCursor)
      throw new Error('No purchasable demo listing left: re-seed the demo data');
    cursor = page.nextCursor;
  }
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
