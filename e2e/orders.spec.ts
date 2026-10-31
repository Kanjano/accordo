import { type APIRequestContext, expect, type Page, test } from '@playwright/test';
import { API, signIn, stepUp, waitForApi } from './helpers';

test.beforeAll(waitForApi);

const SELLER = 'negozio@accordo.local';
const BUYER = 'utente@accordo.local';
const headers = { origin: 'http://localhost:3000' };

interface Detail {
  id: string;
  slug: string;
  shortId: string;
  status: string;
  protectedPaymentEnabled: boolean;
  handDeliveryEnabled: boolean;
  shippingSelf: boolean;
  selfShippingPriceCents: number | null;
}

/** An active listing of the demo shop that can be bought with the given delivery method. */
async function findListing(request: APIRequestContext, method: 'hand' | 'self') {
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
        (method === 'hand' ? l.handDeliveryEnabled : l.shippingSelf && !!l.selfShippingPriceCents)
      )
        return l;
    }
    if (!page.nextCursor)
      throw new Error('No purchasable demo listing left: re-seed the demo data');
    cursor = page.nextCursor;
  }
}

/** Buys through the listing page and the (fake provider) checkout; returns the order page path. */
async function buy(page: Page, l: Detail, method: string) {
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

test('J3: hand delivery with the 6-digit code (SPEC §15.1)', async ({ browser }) => {
  const sellerContext = await browser.newContext();
  const buyerContext = await browser.newContext();
  await signIn(sellerContext, SELLER);
  await signIn(buyerContext, BUYER);
  const listing = await findListing(sellerContext.request, 'hand');

  const buyer = await buyerContext.newPage();
  const orderId = await buy(buyer, listing, 'Consegna a mano');
  await expect(
    buyer.getByRole('status').filter({ hasText: 'In attesa di consegna a mano' }),
  ).toBeVisible({ timeout: 20_000 });

  await stepUp(buyerContext, BUYER);
  await buyer.getByRole('button', { name: 'Mostra il codice di consegna' }).click();
  await expect(buyer.getByText(/Comunica il codice solo dopo/)).toBeVisible();
  const code = (
    await buyer.locator('p.font-mono span[aria-hidden]').textContent()
  )?.trim() as string;
  expect(code).toMatch(/^\d{6}$/);

  const seller = await sellerContext.newPage();
  await seller.goto(`/account/vendite/${orderId}`);
  const wrong = String((Number(code) + 1) % 1_000_000).padStart(6, '0');
  await seller.getByLabel('Codice di consegna').fill(wrong);
  await seller.getByRole('button', { name: 'Verifica' }).click();
  await expect(seller.getByRole('alert').filter({ hasText: 'Codice errato' })).toBeVisible();
  await seller.getByLabel('Codice di consegna').fill(code);
  await seller.getByRole('button', { name: 'Verifica' }).click();
  await expect(seller.getByRole('status').filter({ hasText: 'Completato' })).toBeVisible();
  // The transfer runs in the worker right after completion.
  await expect(seller.getByText('Pagamento trasferito sul tuo account.')).toBeVisible({
    timeout: 30_000,
  });

  await buyer.reload();
  await expect(buyer.getByRole('status').filter({ hasText: 'Completato' })).toBeVisible();
  await sellerContext.close();
  await buyerContext.close();
});

test('self shipping: pay → ship with tracking → confirm with step-up → transfer', async ({
  browser,
}) => {
  const sellerContext = await browser.newContext();
  const buyerContext = await browser.newContext();
  await signIn(sellerContext, SELLER);
  await signIn(buyerContext, BUYER);
  const listing = await findListing(sellerContext.request, 'self');
  const addresses = await (await buyerContext.request.get(`${API}/api/v1/me/addresses`)).json();
  if (!addresses.some((a: { type: string }) => a.type === 'SHIPPING'))
    await buyerContext.request.post(`${API}/api/v1/me/addresses`, {
      headers,
      data: {
        type: 'SHIPPING',
        fullName: 'Utente Demo',
        line1: 'Via Roma 1',
        cap: '20121',
        comuneId: '015146',
        phone: '3331234567',
        isDefault: true,
      },
    });

  const buyer = await buyerContext.newPage();
  const orderId = await buy(buyer, listing, 'Spedizione del venditore');
  await expect(buyer.getByRole('status').filter({ hasText: 'Pagato' })).toBeVisible({
    timeout: 20_000,
  });

  const seller = await sellerContext.newPage();
  await seller.goto(`/account/vendite/${orderId}`);
  await expect(seller.getByText('Indirizzo di spedizione')).toBeVisible();
  await seller.getByLabel('Corriere').selectOption('BRT');
  await seller.getByLabel('Numero di tracking').fill(`BRT${Date.now()}`);
  await seller.getByRole('button', { name: 'Segna come spedito' }).click();
  await expect(seller.getByRole('status').filter({ hasText: 'Spedito' })).toBeVisible();

  await stepUp(buyerContext, BUYER);
  await buyer.reload();
  buyer.once('dialog', (d) => d.accept());
  await buyer.getByRole('button', { name: 'Conferma ricezione' }).click();
  await expect(buyer.getByRole('status').filter({ hasText: 'Completato' })).toBeVisible();

  await seller.reload();
  await expect(seller.getByText('Pagamento trasferito sul tuo account.')).toBeVisible({
    timeout: 30_000,
  });
  await sellerContext.close();
  await buyerContext.close();
});
