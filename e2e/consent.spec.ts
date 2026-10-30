import { expect, test } from '@playwright/test';

const analyticsScript = 'script[data-analytics]';

test('no analytics script is loaded before consent (SPEC §14.5)', async ({ page }) => {
  await page.goto('/');
  const banner = page.getByRole('region', { name: 'Rispettiamo la tua privacy' });
  await expect(banner).toBeVisible();
  // Accept and Reject are equally prominent; nothing is pre-ticked.
  await expect(banner.getByRole('button', { name: 'Accetta tutti' })).toBeVisible();
  await expect(banner.getByRole('button', { name: 'Rifiuta' })).toBeVisible();
  await expect(page.locator(analyticsScript)).toHaveCount(0);

  // Closing with the X means no consent.
  await banner.getByRole('button', { name: 'Chiudi senza accettare' }).click();
  await page.reload();
  await expect(banner).toBeHidden();
  await expect(page.locator(analyticsScript)).toHaveCount(0);

  // Granular choice: analytics unchecked by default, then accepted explicitly.
  await page.getByRole('button', { name: 'Preferenze cookie' }).click();
  await expect(banner.getByRole('checkbox', { name: /Statistiche/ })).not.toBeChecked();
  await banner.getByRole('button', { name: 'Accetta tutti' }).click();
  await expect(page.locator(analyticsScript)).toHaveCount(1);
});
