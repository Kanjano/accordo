import { expect, test } from '@playwright/test';
import { API, register, rejectCookies, signIn, waitForApi } from './helpers';
import { findListing, headers, SELLER } from './shop';

test.beforeAll(waitForApi);

const euro = (cents: number) =>
  new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR' }).format(cents / 100);

/** A random, formally valid Partita IVA (Luhn-style check digit). */
function partitaIva(): string {
  const digits = Array.from({ length: 10 }, () => Math.floor(Math.random() * 10));
  const sum = digits.reduce((s, d, i) => {
    if (i % 2 === 0) return s + d;
    const x = d * 2;
    return s + (x > 9 ? x - 9 : x);
  }, 0);
  return `${digits.join('')}${(10 - (sum % 10)) % 10}`;
}

test('a shop listing shows legal data, "Venditore professionale" and the 30-day lowest price', async ({
  browser,
}) => {
  const seller = await browser.newContext();
  await signIn(seller, SELLER);
  const listing = await findListing(seller.request, 'hand');
  const before = (await (await seller.request.get(`${API}/api/v1/listings/${listing.id}`)).json())
    .priceCents as number;
  const after = Math.round((before * 0.9) / 100) * 100;
  const res = await seller.request.patch(`${API}/api/v1/listings/${listing.id}`, {
    headers,
    data: { priceCents: after },
  });
  expect(res.ok()).toBe(true);

  const visitor = await browser.newContext();
  await rejectCookies(visitor);
  const page = await visitor.newPage();
  await page.goto(`/annuncio/${listing.slug}-${listing.shortId}`);
  const sellerBox = page.getByRole('region', { name: 'Venditore' });
  await expect(sellerBox.getByText('Venditore professionale', { exact: true })).toBeVisible();
  await expect(sellerBox.getByText(/P\.IVA \d{11}/)).toBeVisible();
  await expect(page.getByText(/Ribasso −\d+%/)).toBeVisible();
  await expect(
    page.getByText(`Prezzo più basso degli ultimi 30 giorni: ${euro(before)}`),
  ).toBeVisible();
  await expect(page.getByText('Venditore privato.')).toHaveCount(0);
});

test('a private listing shows the consumer-rights notice', async ({ page, context }) => {
  await rejectCookies(context);
  const { hits } = (await (
    await page.request.get(`${API}/api/v1/search/listings?sellerType=PRIVATE&hitsPerPage=1`)
  ).json()) as { hits: Array<{ slug: string; shortId: string }> };
  const l = hits[0];
  expect(l).toBeTruthy();
  await page.goto(`/annuncio/${l?.slug}-${l?.shortId}`);
  const sellerBox = page.getByRole('region', { name: 'Venditore' });
  await expect(sellerBox.getByText('Venditore privato.')).toBeVisible();
  await expect(sellerBox.getByText(/non si applicano agli acquisti da privati/)).toBeVisible();
  await expect(sellerBox.getByText('Venditore professionale', { exact: true })).toHaveCount(0);
});

test('"Diventa negozio": the application goes to the staff queue', async ({ page }) => {
  await register(page);
  await page.goto('/account/negozio');
  await expect(page.getByRole('heading', { name: 'Diventa negozio' })).toBeVisible();
  const stamp = Date.now();
  await page.getByLabel('Ragione sociale').fill(`Prova Musica ${stamp} S.r.l.`);
  await page.getByLabel('Partita IVA').fill(partitaIva());
  await page.getByLabel('Indirizzo della sede').fill('Via Roma 1');
  await page.getByLabel('CAP').fill('20121');
  await page.getByLabel('Comune').fill('Milano');
  await page
    .getByRole('option', { name: /^Milano/ })
    .first()
    .click();
  await page.getByLabel('Email', { exact: true }).fill(`shop.${stamp}@example.test`);
  await page.getByLabel('Telefono').fill('02 1234567');
  await page.getByLabel('Nome del negozio').fill(`Prova Musica ${stamp}`);
  await page
    .getByLabel('Politica resi')
    .fill('Recesso entro 14 giorni dalla consegna, rimborso entro 14 giorni.');
  await page
    .getByLabel('Garanzia')
    .fill('Garanzia legale di 24 mesi sul nuovo e 12 mesi sull’usato.');
  await page.getByRole('checkbox', { name: /operatore commerciale/ }).check();
  await page.getByRole('button', { name: 'Invia la richiesta' }).click();
  await expect(page.getByText('Richiesta in verifica')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Il mio negozio' })).toBeVisible();
});
