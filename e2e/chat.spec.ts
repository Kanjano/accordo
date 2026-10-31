import { expect, test } from '@playwright/test';
import { API, register, rejectCookies, signIn, waitForApi } from './helpers';

test.beforeAll(waitForApi);

test('J6: real-time chat between two browsers, with a warning on an IBAN (SPEC §15.1)', async ({
  browser,
}) => {
  const sellerContext = await browser.newContext();
  const buyerContext = await browser.newContext();
  await signIn(sellerContext, 'negozio@accordo.local');
  // A new buyer each run: the IBAN below is a flagged message, and 5 of them in 24 h from the
  // same account would rightly limit it (SPEC §13.4).
  await rejectCookies(buyerContext);
  await register(await buyerContext.newPage());

  // The oldest active listing: the same conversation across runs (5 flagged conversations in 24 h
  // would rightly limit the buyer, SPEC §13.4).
  const mine = (await (
    await sellerContext.request.get(`${API}/api/v1/me/listings?status=ACTIVE`)
  ).json()) as Array<{
    slug: string;
    shortId: string;
    publishedAt: string;
  }>;
  const listing = mine.sort((a, b) =>
    a.publishedAt.localeCompare(b.publishedAt),
  )[0] as (typeof mine)[number];

  // The buyer contacts the seller from the listing page.
  const buyer = await buyerContext.newPage();
  await buyer.goto(`/annuncio/${listing.slug}-${listing.shortId}`);
  await buyer.getByRole('button', { name: 'Contatta il venditore' }).click();
  await buyer.getByLabel('Il tuo messaggio').fill(`Ciao, è disponibile? ${Date.now()}`);
  await buyer.getByRole('button', { name: 'Invia', exact: true }).click();
  await expect(buyer).toHaveURL(/\/messaggi\/[0-9a-f-]{36}$/);
  const conversationUrl = new URL(buyer.url()).pathname;

  // The seller opens the same conversation in another browser.
  const seller = await sellerContext.newPage();
  await seller.goto(conversationUrl);
  await expect(seller.getByRole('heading', { name: /Conversazione con/ })).toBeVisible();

  // An IBAN arrives in real time (under 3 s, faster than the 5 s polling fallback) with the warning.
  const scam = `Fammi un bonifico qui: IT60 X054 2811 1010 0000 0123 456 (${Date.now()})`;
  await buyer.getByLabel('Scrivi un messaggio').fill(scam);
  await buyer.getByLabel('Scrivi un messaggio').press('Enter');
  await expect(seller.getByText(scam)).toBeVisible({ timeout: 3000 });
  await expect(
    seller.getByRole('alert').filter({ hasText: 'paga solo con il pagamento protetto' }).last(),
  ).toBeVisible();

  // And back: the seller's reply appears for the buyer, without the warning on own messages.
  const reply = `Preferisco il pagamento protetto, grazie (${Date.now()})`;
  await seller.getByLabel('Scrivi un messaggio').fill(reply);
  await seller.getByRole('button', { name: 'Invia', exact: true }).click();
  await expect(buyer.getByText(reply)).toBeVisible({ timeout: 3000 });

  await sellerContext.close();
  await buyerContext.close();
});
