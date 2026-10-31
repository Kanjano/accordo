import { resolve } from 'node:path';
import { expect, test } from '@playwright/test';
import { API, signIn, waitForApi } from './helpers';
import { BUYER, buy, findListing, headers, SELLER } from './shop';

test.beforeAll(waitForApi);

test('J5: "not as described" → partial refund → rest transferred (SPEC §15.1)', async ({
  browser,
}) => {
  const sellerContext = await browser.newContext();
  const buyerContext = await browser.newContext();
  await signIn(sellerContext, SELLER);
  await signIn(buyerContext, BUYER);
  const listing = await findListing(sellerContext.request, 'integrated');

  const buyer = await buyerContext.newPage();
  const orderId = await buy(buyer, listing, 'Spedizione integrata');
  // Label, then carrier events up to the delivery (dev endpoint → signed webhook → worker).
  let shipmentId = '';
  await expect
    .poll(
      async () => {
        const d = await (await sellerContext.request.get(`${API}/api/v1/orders/${orderId}`)).json();
        shipmentId = d.shipments[0]?.id ?? '';
        return shipmentId;
      },
      { timeout: 30_000 },
    )
    .not.toBe('');
  for (const status of ['IN_TRANSIT', 'OUT_FOR_DELIVERY', 'DELIVERED']) {
    await sellerContext.request.post(`${API}/api/v1/dev/shipments/${shipmentId}/advance`, {
      headers,
    });
    await expect
      .poll(
        async () =>
          (await (await sellerContext.request.get(`${API}/api/v1/orders/${orderId}`)).json())
            .shipments[0].status,
        { timeout: 20_000 },
      )
      .toBe(status);
  }
  await expect
    .poll(
      async () =>
        (await (await buyerContext.request.get(`${API}/api/v1/orders/${orderId}`)).json()).status,
      { timeout: 20_000 },
    )
    .toBe('DELIVERED');

  // The buyer opens the dispute with two photos.
  await buyer.goto(`/account/acquisti/${orderId}`);
  await buyer.getByRole('link', { name: 'Segnala un problema' }).click();
  await buyer.getByLabel('Motivo').selectOption('NOT_AS_DESCRIBED');
  await buyer
    .getByLabel('Descrizione')
    .fill("La custodia indicata nell'annuncio non c'era e il manico ha un graffio.");
  await buyer
    .getByTestId('evidence-input')
    .setInputFiles([1, 2].map((n) => resolve(import.meta.dirname, `fixtures/photo-${n}.jpg`)));
  await expect(buyer.getByText('2 foto caricate')).toBeVisible({ timeout: 20_000 });
  await buyer.getByRole('button', { name: 'Apri la controversia' }).click();
  await expect(buyer).toHaveURL(new RegExp(`/account/acquisti/${orderId}$`));
  await expect(buyer.getByRole('heading', { name: /Controversia · Aperta/ })).toBeVisible();
  await expect(buyer.getByRole('img', { name: /Prova 1/ })).toBeVisible();

  // The seller proposes 30 € back.
  const seller = await sellerContext.newPage();
  await seller.goto(`/account/vendite/${orderId}`);
  await seller.getByRole('radio', { name: 'Propongo un rimborso parziale' }).check();
  await seller.getByLabel(/Importo del rimborso/).fill('30');
  await seller
    .getByLabel("Messaggio per l'acquirente")
    .fill('Mi dispiace, ti rimborso 30 € per la custodia.');
  await seller.getByRole('button', { name: 'Invia la risposta' }).click();
  await expect(seller.getByText(/propone un rimborso parziale di 30,00/)).toBeVisible();

  // The buyer accepts: partial refund, the rest goes to the seller.
  await buyer.reload();
  await buyer.getByRole('button', { name: 'Accetta la proposta' }).click();
  await expect(buyer.getByRole('status').filter({ hasText: 'Completato' })).toBeVisible();
  await expect(async () => {
    await buyer.reload();
    await expect(buyer.getByText('Rimborsato')).toBeVisible({ timeout: 1000 });
  }).toPass({ timeout: 30_000 });
  await seller.reload();
  await expect(seller.getByText('Pagamento trasferito sul tuo account.')).toBeVisible({
    timeout: 30_000,
  });
  await sellerContext.close();
  await buyerContext.close();
});

test('J8: missed shipment → automatic cancellation → full refund (SPEC §15.1)', async ({
  browser,
}) => {
  const sellerContext = await browser.newContext();
  const buyerContext = await browser.newContext();
  await signIn(sellerContext, SELLER);
  await signIn(buyerContext, BUYER);
  const listing = await findListing(sellerContext.request, 'self');
  const buyer = await buyerContext.newPage();
  const orderId = await buy(buyer, listing, 'Spedizione del venditore');
  await expect(buyer.getByRole('status').filter({ hasText: 'Pagato' })).toBeVisible({
    timeout: 20_000,
  });

  // Forced timers (development endpoint): the 24 h reminder, then the shipping deadline.
  for (const action of ['SHIP_REMINDER', 'SHIP_DEADLINE']) {
    const res = await buyerContext.request.post(`${API}/api/v1/dev/orders/${orderId}/run-timer`, {
      headers,
    });
    expect((await res.json()).action).toBe(action);
  }
  await buyer.reload();
  await expect(buyer.getByRole('status').filter({ hasText: 'Annullato' })).toBeVisible();
  const detail = await (await buyerContext.request.get(`${API}/api/v1/orders/${orderId}`)).json();
  await expect
    .poll(
      async () =>
        (await (await buyerContext.request.get(`${API}/api/v1/orders/${orderId}`)).json()).amounts
          .refundedCents,
      { timeout: 30_000 },
    )
    .toBe(detail.amounts.totalCents);
  await sellerContext.close();
  await buyerContext.close();
});
