import { expect, type Page, test } from '@playwright/test';
import { latestEmailHtml, totp, waitForApi } from './helpers';

test.beforeAll(waitForApi);

async function dismissCookies(page: Page) {
  const reject = page.getByRole('button', { name: 'Rifiuta' });
  if (await reject.isVisible().catch(() => false)) await reject.click();
}

/** Codes are single-use: wait for a fresh 30 s window when needed. */
async function freshCode(secret: string, used: Set<string>) {
  let code = totp(secret);
  while (used.has(code)) {
    await new Promise((r) => setTimeout(r, 2_000));
    code = totp(secret);
  }
  used.add(code);
  return code;
}

test('registration → email verification → sign-in → 2FA → sign-in with TOTP', async ({ page }) => {
  const stamp = Date.now();
  const email = `e2e.${stamp}@example.test`;
  const password = 'una-password-molto-lunga';
  const usedCodes = new Set<string>();

  // Registration (Turnstile test keys pass automatically).
  await page.goto('/registrati');
  await dismissCookies(page);
  await page.getByLabel('Nome e cognome').fill('Utente E2E');
  await page.getByLabel('Nome utente', { exact: true }).fill(`e2e${stamp}`);
  await page.getByLabel('Email', { exact: true }).fill(email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('checkbox', { name: /Accetto i Termini/ }).check();
  const submit = page.getByRole('button', { name: 'Registrati' });
  await expect(submit).toBeEnabled({ timeout: 30_000 });
  await submit.click();
  await expect(page.getByText('Controlla la tua email')).toBeVisible();

  // Verification link from Mailpit: confirms the email and signs in.
  const link = /href="([^"]*verify-email[^"]*)"/
    .exec(await latestEmailHtml(email))?.[1]
    ?.replace(/&amp;/g, '&');
  expect(link).toBeTruthy();
  await page.goto(link as string);
  await expect(page).toHaveURL(/verifica-email\?stato=ok/);
  await page.getByRole('link', { name: 'Vai al tuo account' }).click();
  await expect(page.getByRole('heading', { name: 'Ciao Utente E2E!' })).toBeVisible();

  // Turn on two-step verification.
  await page.goto('/account/impostazioni/sicurezza');
  await page.getByLabel('Conferma con la password').fill(password);
  await page.getByRole('button', { name: 'Attiva', exact: true }).click();
  const secret = (await page.getByTestId('totp-secret').textContent())?.trim() ?? '';
  expect(secret).toMatch(/^[A-Z2-7]+=*$/);
  await page.getByLabel('Codice a 6 cifre').fill(await freshCode(secret, usedCodes));
  await page.getByRole('button', { name: 'Verifica e attiva' }).click();
  await expect(page.getByText('Verifica in due passaggi attivata.')).toBeVisible();
  await expect(page.getByTestId('backup-codes').getByRole('listitem')).toHaveCount(10);

  // Sign out, then sign in again: password, then TOTP.
  await page.getByRole('button', { name: 'Esci', exact: true }).click();
  await page.goto('/accedi');
  await page.getByLabel('Email', { exact: true }).fill(email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Accedi', exact: true }).click();
  await expect(page.getByText('Verifica in due passaggi')).toBeVisible();
  await page.getByLabel('Codice di verifica').fill(await freshCode(secret, usedCodes));
  await page.getByRole('button', { name: 'Verifica' }).click();
  await expect(page.getByRole('heading', { name: 'Ciao Utente E2E!' })).toBeVisible();
});

test('the private area redirects anonymous visitors to sign-in', async ({ page }) => {
  await page.goto('/account/impostazioni/profilo');
  await expect(page).toHaveURL(/\/accedi\?next=%2Faccount%2Fimpostazioni%2Fprofilo/);
});
