import { expect, test } from '@playwright/test';
import { API, register, rejectCookies, signIn, waitForApi } from './helpers';
import { findListing, headers, SELLER } from './shop';

test.beforeAll(waitForApi);

const euros = (cents: number) => Math.floor(cents / 100);
const price = (eur: number) => new RegExp(`${eur.toLocaleString('it-IT')},00\\s€`);

test('J4: offer → counter-offer → acceptance → checkout at the agreed price (SPEC §15.1)', async ({
  browser,
}) => {
  const sellerContext = await browser.newContext();
  await signIn(sellerContext, SELLER);
  const listing = await findListing(sellerContext.request, 'hand');
  const patched = await sellerContext.request.patch(`${API}/api/v1/listings/${listing.id}`, {
    headers,
    data: { isNegotiable: true },
  });
  expect(patched.ok()).toBe(true);
  const priceCents = (
    await (await sellerContext.request.get(`${API}/api/v1/listings/${listing.shortId}`)).json()
  ).priceCents as number;
  const offer = euros(priceCents * 0.7);
  const counter = euros(priceCents * 0.85);

  // A new buyer (offers are limited per day) makes an offer from the listing page.
  const buyerContext = await browser.newContext();
  await rejectCookies(buyerContext);
  const buyer = await buyerContext.newPage();
  await register(buyer);
  await buyer.goto(`/annuncio/${listing.slug}-${listing.shortId}`);
  await buyer.getByRole('button', { name: "Fai un'offerta" }).click();
  await buyer.getByLabel('La tua offerta (€)').fill(String(offer));
  await buyer.getByRole('button', { name: "Fai un'offerta" }).last().click();
  await expect(buyer).toHaveURL(/\/messaggi\/[0-9a-f-]{36}$/);
  const conversation = new URL(buyer.url()).pathname;

  // The seller counters.
  const seller = await sellerContext.newPage();
  await seller.goto(conversation);
  const sellerOffers = seller.getByRole('region', { name: 'Offerte' });
  await expect(sellerOffers.getByText(price(offer))).toBeVisible();
  await sellerOffers.getByLabel('Controproposta (€)').fill(String(counter));
  await sellerOffers.getByRole('button', { name: 'Controproponi' }).click();

  // The buyer accepts the counter-offer and pays the agreed price.
  const buyerOffers = buyer.getByRole('region', { name: 'Offerte' });
  await expect(buyerOffers.getByText(price(counter))).toBeVisible({ timeout: 10_000 });
  await buyerOffers.getByRole('button', { name: 'Accetta' }).click();
  await buyerOffers.getByRole('link', { name: 'Paga ora al prezzo concordato' }).click();
  const box = buyer.getByRole('region', { name: 'Compra con pagamento protetto' });
  await box.getByRole('radio', { name: /Consegna a mano/ }).check();
  await box.getByRole('button', { name: 'Compra', exact: true }).click();
  await expect(buyer).toHaveURL(/\/checkout\/[0-9a-f-]{36}$/);
  const orderId = new URL(buyer.url()).pathname.split('/').at(-1);
  const order = await (await buyerContext.request.get(`${API}/api/v1/orders/${orderId}`)).json();
  expect(order.amounts.itemPriceCents).toBe(counter * 100);
  await expect(buyer.getByText(price(counter)).first()).toBeVisible();

  await sellerContext.close();
  await buyerContext.close();
});
