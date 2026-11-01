import AxeBuilder from '@axe-core/playwright';
import { expect, type Page, test } from '@playwright/test';
import { rejectCookies, signIn, waitForApi } from './helpers';
import { BUYER, findListing, SELLER } from './shop';

test.beforeAll(waitForApi);

/** WCAG 2.2 AA rules; serious and critical violations fail the test (SPEC §15.1). */
async function expectAccessible(page: Page) {
  await page.waitForLoadState('networkidle');
  const { violations } = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
    .analyze();
  const blocking = violations
    .filter((v) => v.impact === 'serious' || v.impact === 'critical')
    .map((v) => `${v.id} (${v.impact}): ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`);
  expect(blocking, page.url()).toEqual([]);
}

test('axe: home, search and listing page', async ({ page, context }) => {
  await rejectCookies(context);
  await page.goto('/');
  await expectAccessible(page);
  await page.goto('/annunci?q=chitarra');
  await expectAccessible(page);
  await page.locator('a[href*="/annuncio/"]').first().click();
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await expectAccessible(page);
});

test('axe: listing wizard, account area and checkout', async ({ browser }) => {
  const sellerContext = await browser.newContext();
  await signIn(sellerContext, SELLER);
  const listing = await findListing(sellerContext.request, 'hand');
  await sellerContext.close();

  const context = await browser.newContext();
  await signIn(context, BUYER);
  const page = await context.newPage();
  await page.goto('/vendi');
  await expect(page.getByRole('heading', { name: 'Vendi', exact: true })).toBeVisible();
  await expectAccessible(page);
  await page.goto('/account');
  await expectAccessible(page);

  await page.goto(`/annuncio/${listing.slug}-${listing.shortId}`);
  const box = page.getByRole('region', { name: 'Compra con pagamento protetto' });
  await box.getByRole('radio', { name: /Consegna a mano/ }).check();
  await box.getByRole('button', { name: 'Compra', exact: true }).click();
  await expect(page).toHaveURL(/\/checkout\/[0-9a-f-]{36}$/);
  await expectAccessible(page);
  await context.close();
});
