import { expect, test } from '@playwright/test';
import { API, emailContaining, rejectCookies, signIn, signInStaff, waitForApi } from './helpers';
import { findListing, SELLER } from './shop';

test.beforeAll(waitForApi);

test('J7: report a listing → removal by a moderator → email with the reasons → appeal (SPEC §15.1)', async ({
  browser,
}) => {
  const stamp = Date.now();
  const seller = await browser.newContext();
  await signIn(seller, SELLER);
  const listing = await findListing(seller.request, 'hand');

  // 1. Anyone can report, without an account (DSA notice & action, Turnstile test keys).
  const visitor = await browser.newContext();
  await rejectCookies(visitor);
  const page = await visitor.newPage();
  await page.goto(`/annuncio/${listing.slug}-${listing.shortId}`);
  await page.getByRole('link', { name: "Segnala l'annuncio" }).click();
  await expect(page.getByRole('heading', { name: 'Segnala un contenuto' })).toBeVisible();
  await page.getByLabel('Motivo').selectOption('COUNTERFEIT');
  await page
    .getByLabel('Descrizione')
    .fill(`Lo strumento sembra contraffatto: il logo non corrisponde all'originale (${stamp}).`);
  await page.getByRole('checkbox', { name: /contenuto sia illegale/ }).check();
  await page.getByLabel('Nome e cognome').fill('Segnalatore Prova');
  const reporterEmail = `e2e.report.${stamp}@example.test`;
  await page.getByLabel('Email').fill(reporterEmail);
  await page.getByRole('checkbox', { name: /buona fede/ }).check();
  const send = page.getByRole('button', { name: 'Invia la segnalazione' });
  await expect(send).toBeEnabled({ timeout: 30_000 });
  await send.click();
  await expect(page.getByText('Segnalazione inviata')).toBeVisible();
  await emailContaining(reporterEmail, 'la tua segnalazione è stata registrata');

  // 2. The moderator (2FA) removes the listing with a statement of reasons.
  const mod = await browser.newContext();
  await signInStaff(mod, 'moderatore@accordo.local');
  const modPage = await mod.newPage();
  await modPage.goto('/admin/segnalazioni');
  const card = modPage.getByRole('article').filter({ hasText: reporterEmail });
  await expect(card).toBeVisible();
  await card.getByLabel('Decisione', { exact: true }).selectOption('REMOVE_LISTING');
  await card.getByLabel('Motivo').selectOption('COUNTERFEIT');
  const statement = `Annuncio rimosso: prodotto contraffatto, vietato dalle Regole di pubblicazione (${stamp}).`;
  await card.getByLabel(/Motivazione per l'utente/).fill(statement);
  await card.getByRole('button', { name: 'Conferma la decisione' }).click();
  await expect(card).toHaveCount(0);
  expect((await visitor.request.get(`${API}/api/v1/listings/${listing.id}`)).status()).toBe(404);

  // 3. The seller gets the reasons by email; the reporter gets the outcome.
  await emailContaining(SELLER, statement);
  await emailContaining(reporterEmail, statement);

  // 4. The seller appeals from "Moderazione".
  const sellerPage = await seller.newPage();
  await sellerPage.goto('/account/moderazione');
  const decision = sellerPage.getByRole('article').filter({ hasText: statement });
  await decision.getByRole('button', { name: 'Presenta ricorso' }).click();
  await decision
    .getByLabel(/Perché la decisione è sbagliata/)
    .fill('Lo strumento è originale: ho la fattura del distributore ufficiale.');
  await decision.getByRole('button', { name: 'Invia il ricorso' }).click();
  await expect(decision.getByText('Ricorso presentato')).toBeVisible();

  // 5. Another staff member upholds the appeal: the listing is back online.
  const admin = await browser.newContext();
  await signInStaff(admin, 'admin@accordo.local');
  const adminPage = await admin.newPage();
  await adminPage.goto('/admin/ricorsi');
  const appeal = adminPage.getByRole('listitem').filter({ hasText: statement });
  await appeal
    .getByLabel(/Motivazione per l'utente/)
    .fill('La fattura dimostra che lo strumento è originale.');
  await appeal.getByRole('button', { name: /Accogli/ }).click();
  await expect(appeal).toHaveCount(0);
  expect((await visitor.request.get(`${API}/api/v1/listings/${listing.id}`)).status()).toBe(200);
});
