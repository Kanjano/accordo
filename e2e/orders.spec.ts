import { expect, test } from '@playwright/test';
import { API, signIn, stepUp, waitForApi } from './helpers';
import { BUYER, buy, findListing, headers, SELLER } from './shop';

test.beforeAll(waitForApi);

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

test('J2: integrated shipping → label → carrier events → delivery → confirmation → transfer', async ({
  browser,
}) => {
  const sellerContext = await browser.newContext();
  const buyerContext = await browser.newContext();
  await signIn(sellerContext, SELLER);
  await signIn(buyerContext, BUYER);
  const listing = await findListing(sellerContext.request, 'integrated');

  const buyer = await buyerContext.newPage();
  const orderId = await buy(buyer, listing, 'Spedizione integrata');
  await expect(buyer.getByRole('status').filter({ hasText: 'Pagato' })).toBeVisible({
    timeout: 20_000,
  });

  // The worker buys the label (mock provider) and stores it in the private bucket.
  const seller = await sellerContext.newPage();
  await seller.goto(`/account/vendite/${orderId}`);
  const download = seller.getByRole('link', { name: "Scarica l'etichetta (PDF)" });
  await expect(async () => {
    await seller.reload();
    await expect(download).toBeVisible({ timeout: 1000 });
  }).toPass({ timeout: 30_000 });
  const pdf = await sellerContext.request.get(`${API}/api/v1/orders/${orderId}/label`);
  expect(pdf.headers()['content-type']).toBe('application/pdf');
  expect((await pdf.body()).subarray(0, 8).toString()).toBe('%PDF-1.4');
  expect((await buyerContext.request.get(`${API}/api/v1/orders/${orderId}/label`)).status()).toBe(
    404,
  );
  await expect(seller.getByRole('link', { name: 'Come imballare uno strumento' })).toBeVisible();

  // Carrier events (dev endpoint → signed webhook → worker): taken over, out for delivery, delivered.
  const detail = await (await sellerContext.request.get(`${API}/api/v1/orders/${orderId}`)).json();
  const shipmentId = detail.shipments[0].id as string;
  for (const expected of ['IN_TRANSIT', 'OUT_FOR_DELIVERY', 'DELIVERED']) {
    const res = await sellerContext.request.post(
      `${API}/api/v1/dev/shipments/${shipmentId}/advance`,
      { headers },
    );
    expect((await res.json()).status).toBe(expected);
    await expect
      .poll(
        async () =>
          (await (await sellerContext.request.get(`${API}/api/v1/orders/${orderId}`)).json())
            .shipments[0].status,
        { timeout: 20_000 },
      )
      .toBe(expected);
  }
  await buyer.reload();
  await expect(buyer.getByRole('status').filter({ hasText: 'Consegnato' })).toBeVisible({
    timeout: 20_000,
  });

  await stepUp(buyerContext, BUYER);
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
