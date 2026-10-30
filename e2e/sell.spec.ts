import { resolve } from 'node:path';
import { expect, test } from '@playwright/test';
import { rejectCookies, waitForApi } from './helpers';

test.beforeAll(waitForApi);

test('a seller publishes a listing with 5 photos and it is visible on its page', async ({
  page,
  context,
}) => {
  await rejectCookies(context);
  const title = `Chitarra elettrica Fender e2e ${Date.now()}`;

  await page.goto('/accedi?next=/vendi');
  await page.getByLabel('Email', { exact: true }).fill('utente@accordo.local');
  await page.getByLabel('Password', { exact: true }).fill('accordo-demo-2026');
  await page.getByRole('button', { name: 'Accedi', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Vendi', exact: true })).toBeVisible();

  // 1. Category, suggested from the title.
  await page.getByLabel("Titolo dell'annuncio").fill(title);
  await page.getByRole('radio', { name: /Chitarre elettriche/ }).check();
  await page.getByRole('button', { name: 'Continua' }).click();

  // 2. Details (creates the draft on continue).
  await page.getByRole('radio', { name: /Ottime condizioni/ }).check();
  await page
    .getByLabel('Descrizione')
    .fill('Chitarra tenuta benissimo, regolata di recente. Custodia inclusa.');
  await page.getByRole('button', { name: 'Continua' }).click();

  // 3. Five photos: resized in the browser, uploaded to storage, processed by the worker.
  await page
    .getByTestId('photo-input')
    .setInputFiles(
      [1, 2, 3, 4, 5].map((n) => resolve(import.meta.dirname, `fixtures/photo-${n}.jpg`)),
    );
  const photos = page.getByTestId('photo-list').getByRole('listitem');
  await expect(photos).toHaveCount(5, { timeout: 60_000 });
  await expect(page.getByTestId('photo-list').getByRole('img')).toHaveCount(5, { timeout: 60_000 });
  await page.getByRole('button', { name: 'Continua' }).click();

  // 4. Price and delivery.
  await page.getByLabel('Prezzo (€)').fill('1500');
  await page.getByRole('button', { name: 'Continua' }).click();

  // 5. Publish.
  await page.getByRole('button', { name: "Pubblica l'annuncio" }).click();
  await expect(page.getByText('Annuncio pubblicato!')).toBeVisible();
  await page.getByRole('link', { name: "Vedi l'annuncio" }).click();

  await expect(page).toHaveURL(
    /\/annuncio\/chitarra-elettrica-fender-e2e-\d+-[0-9A-HJKMNP-TV-Z]{8}$/,
  );
  await expect(page.getByRole('heading', { level: 1, name: title })).toBeVisible();
  await expect(page.getByText(/^1\.?500,00\s€$/).first()).toBeVisible();
  await expect(page.getByRole('button', { name: /^Foto \d di 5$/ })).toHaveCount(5);
  const jsonLd = JSON.parse(
    (await page.locator('script[type="application/ld+json"]').textContent()) ?? '[]',
  );
  expect(jsonLd[0]).toMatchObject({
    '@type': 'Product',
    name: title,
    offers: { price: '1500.00', priceCurrency: 'EUR' },
  });
  expect(jsonLd[0].image).toHaveLength(5);
});
