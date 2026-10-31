import { expect, test } from '@playwright/test';
import { API, register, rejectCookies, signIn, stepUp, waitForApi } from './helpers';
import { findListing, headers, SELLER } from './shop';

test.beforeAll(waitForApi);

test('leave feedback and see the reputation updated (SPEC §16, Phase 9)', async ({ browser }) => {
  const sellerContext = await browser.newContext();
  const buyerContext = await browser.newContext();
  await rejectCookies(buyerContext);
  await signIn(sellerContext, SELLER);
  const buyer = await buyerContext.newPage();
  const email = await register(buyer);

  // A completed hand-delivery order, through the API (the UI path is covered by J3).
  const listing = await findListing(sellerContext.request, 'hand');
  const me = await (await sellerContext.request.get(`${API}/api/v1/me`)).json();
  const reputation = async () =>
    (await (
      await sellerContext.request.get(`${API}/api/v1/users/${me.username}/reputation`)
    ).json()) as {
      score: number;
      periods: { m1: { positive: number } };
    };
  const before = await reputation();
  const order = await (
    await buyerContext.request.post(`${API}/api/v1/orders`, {
      headers: { ...headers, 'idempotency-key': `fb-${Date.now()}` },
      data: { listingId: listing.id, deliveryMethod: 'HAND_DELIVERY' },
    })
  ).json();
  await buyerContext.request.post(`${API}/api/v1/dev/orders/${order.orderId}/payment`, {
    headers,
    data: { outcome: 'succeeded' },
  });
  await expect
    .poll(
      async () =>
        (await (await buyerContext.request.get(`${API}/api/v1/orders/${order.orderId}`)).json())
          .status,
      { timeout: 20_000 },
    )
    .toBe('HANDOVER_PENDING');
  await stepUp(buyerContext, email);
  const { code } = await (
    await buyerContext.request.get(`${API}/api/v1/orders/${order.orderId}/handover-code`)
  ).json();
  await sellerContext.request.post(`${API}/api/v1/orders/${order.orderId}/handover/verify`, {
    headers,
    data: { code },
  });

  // The buyer leaves a positive feedback with the detailed ratings.
  const comment = `Strumento come descritto, venditore gentilissimo (${Math.random().toString(36).slice(2, 8)}).`;
  await buyer.goto(`/account/acquisti/${order.orderId}`);
  await buyer.getByRole('link', { name: 'Lascia un feedback' }).click();
  await expect(buyer).toHaveURL(/\/account\/feedback\?ordine=/);
  await buyer
    .getByRole('group', { name: 'Oggetto conforme alla descrizione' })
    .getByRole('radio', { name: '5 stelle' })
    .check();
  await buyer
    .getByRole('group', { name: 'Comunicazione' })
    .getByRole('radio', { name: '4 stelle' })
    .check();
  await buyer.getByLabel('Commento (facoltativo)').fill(comment);
  await buyer.getByRole('button', { name: 'Pubblica il feedback' }).click();
  await expect(buyer.getByText('Nessun feedback da lasciare.')).toBeVisible();

  // The worker recomputes the reputation from the outbox event.
  await expect
    .poll(async () => (await reputation()).score, { timeout: 30_000 })
    .toBe(before.score + 1);
  expect((await reputation()).periods.m1.positive).toBe(before.periods.m1.positive + 1);

  const page = await sellerContext.newPage();
  await page.goto(`/utente/${me.username}/feedback`);
  await expect(page.getByText(comment)).toBeVisible();
  await expect(page.getByText('Acquisto verificato').first()).toBeVisible();
  await expect(page.getByText(`Punteggio ${before.score + 1}`)).toBeVisible();
  await sellerContext.close();
  await buyerContext.close();
});
