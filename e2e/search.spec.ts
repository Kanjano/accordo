import { expect, test } from '@playwright/test';
import { rejectCookies, waitForApi } from './helpers';

test.beforeAll(waitForApi);

test('search with a typo, suggestions, filters in the URL (SPEC §3.4)', async ({
  page,
  context,
}) => {
  await rejectCookies(context);
  await page.goto('/');
  const box = page.getByRole('combobox', { name: 'Cerca negli annunci' }).first();
  await box.fill('fend');
  await expect(page.getByRole('option', { name: /Fender/ }).first()).toBeVisible();

  await box.fill('fendr');
  await box.press('Enter');
  await expect(page).toHaveURL(/\/annunci\?q=fendr/);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Risultati per «fendr»');
  await expect(page.getByText(/^\d[\d.]* annunci$/)).toBeVisible();
  const results = page
    .getByRole('main')
    .getByRole('listitem')
    .filter({ has: page.locator('article') });
  await expect(results.first()).toContainText(/Fender/i);

  // A filter is reflected in the URL and survives a reload.
  await page.getByRole('checkbox', { name: /^Nuovo/ }).check();
  await expect(page).toHaveURL(/condition=NEW/);
  await page.reload();
  await expect(page.getByRole('checkbox', { name: /^Nuovo/ })).toBeChecked();

  // Landing page with canonical URL.
  await page.goto('/marca/fender');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Strumenti Fender');
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', /\/marca\/fender$/);
});
