# Avanzamento

## Fase 0 — Bootstrap del monorepo e infrastruttura locale ✅

**Piano**
1. Monorepo pnpm + Turborepo, Biome, tsconfig base `strict`, `.nvmrc`, `.editorconfig`, `.gitignore`.
2. `apps/web`: Next.js 16 + Tailwind 4 + next-intl + configurazione shadcn/ui, header/footer, home segnaposto.
3. `apps/api`: NestJS 12, env Zod (avvio bloccato se manca qualcosa), pino, Problem Details, `/health/live` e `/health/ready` (PostgreSQL, Valkey, Meilisearch, storage), creazione bucket in sviluppo.
4. `apps/worker`: NestJS standalone + BullMQ con job heartbeat.
5. Scheletro `packages/*`, compose, `.env.example`, script radice, CI, README, CLAUDE.md, docs.

**Fatto**
- Tutto il piano. `pnpm lint && pnpm typecheck && pnpm test && pnpm build` verdi.
- Verificato a mano: `/health/ready` → tutti `up`; web su :3000 con home in italiano; heartbeat del worker ogni 30 s; 404 in formato Problem Details; bucket `accordo-media` (lettura pubblica) e `accordo-private` creati.
- Deviazioni registrate in `DECISIONS.md` (ADR-0001…0008).

**Rimandato (per piano)**
- Prisma e dominio → Fase 1. CSP → Fase 12. Dockerfile e Caddy → Fase 12. Playwright → Fase 2.

## Fase 1 — Database, seed e dominio puro

**Piano**
1. `packages/db`: schema §10.1 in `prisma/schema.prisma`, `prisma.config.ts`, migrazione `init` + migrazione SQL §10.2, client esportato con `@prisma/adapter-pg`.
2. Geografia: `pnpm geo:import` scarica l'elenco ISTAT dei comuni e le coordinate da fonte aperta e scrive `packages/db/data/comuni.json` (versionato, così il seed funziona offline); fallback incluso con i soli capoluoghi di provincia. Fonti e licenze in `docs/DATA_SOURCES.md`.
3. Seed base idempotente: geografia, reparti/categorie §19.1, attributi §19.2, marche con alias §19.3, festività §19.5 (anno corrente + 2), `PlatformSetting` dai default §17.1. Seed demo §19.6 (solo sviluppo) con Faker `it` e immagini segnaposto generate con sharp.
4. `packages/domain`: `computeOrderAmounts`, `OrderStateMachine`, giorni lavorativi + Pasquetta, scritture ledger, reputazione (score, %, DSR, livelli, Venditore Top, quote revisioni, weekKey), `scanMessage`, prezzo anomalo, distanza Hamming dHash, slug, `shortId`, numero d'ordine, validatori P.IVA e codice fiscale. Copertura ≥ 95%.
5. API `/health/ready` passa a Prisma.

**Fatto**
- `packages/db`: schema §10.1 (con le opzioni ESM del generator), migrazioni `init` e `domain_constraints` (§10.2), `createPrismaClient()` su `@prisma/adapter-pg`. Test di integrazione con Testcontainers (`pnpm test:integration`): un solo ordine attivo per annuncio anche con due checkout concorrenti, totale ordine, prezzo positivo, feedback del venditore solo positivo, DSR 1–5, importi del ledger positivi, indici `pg_trgm`/GIN.
- Geografia: 20 regioni, 107 province, 7.896 comuni (ISTAT + Wikidata), fallback con i capoluoghi.
- Seed di base: 12 reparti, 98 categorie, 54 attributi, 120 marche con alias, 36 festività (2026–2028), 9 chiavi di impostazioni.
- Seed demo (~18 s): 60 utenti (10 negozi, 3 staff), 2.000 annunci con ~5.000 foto segnaposto su RustFS, 184 ordini (almeno 2 per stato, generati con la vera macchina a stati), ledger bilanciato, 256 feedback (96,9% positivi), reputazioni calcolate, 2 controversie aperte, 146 conversazioni (una con IBAN segnalato), offerte, preferiti, ricerche salvate, 3 segnalazioni.
- `packages/domain` (418 test, copertura 99,6% statements / 97,5% branch, soglia 95% imposta in `vitest.config.ts`): importi, macchina a stati + `sweeperStep`, giorni lavorativi e festività con Pasquetta, codice di consegna (HMAC, tempo costante, 5 tentativi), ledger, reputazione (deduplicazione settimanale, 12 mesi, DSR, livelli, Venditore Top, revisioni), `scanMessage` con corpus italiano offuscato, controlli annuncio (prezzo anomalo, parole vietate), dHash + Hamming, slug, `shortId`, numero d'ordine, P.IVA e codice fiscale.
- API: `/health/ready` interroga il database via Prisma.
- Verificato: 0 transazioni di ledger sbilanciate; `SELLER_PAYABLE` a zero su tutti gli ordini chiusi; nessun timer di ordine nel passato; seed ripetibile.
- Decisioni: ADR-0009…0017.

**Note**
- Nessun Venditore Top tra i dati demo (nessun venditore arriva a 20 vendite): la logica è coperta dai test.

## Fase 2 — Autenticazione, profili e impostazioni

**Piano**
1. API `auth`: Better Auth 1.7 montato su `/api/auth/*` (handler Node su Express, ADR), adapter Prisma, email+password (min 10), verifica email obbligatoria, reset password, Google (se configurato), plugin admin/username/twoFactor/passkey, captcha Turnstile (chiavi di test), rate limit su Valkey, id generati da Prisma.
2. Guard globali: sessione, email verificata, ruoli (staff con 2FA obbligatoria), impersonificazione in sola lettura, controllo `Origin`; step-up (`STEP_UP_REQUIRED`) con dispositivi riconosciuti (cookie firmato + `KnownDevice`) e codice email per dispositivi nuovi; avviso email di nuovo accesso.
3. Email: porta `EmailProvider` (SMTP → Mailpit), template React Email in `packages/emails` (verifica, reset, nuovo dispositivo, codice step-up, password cambiata).
4. API `users`/`geo`: `GET/PATCH /me`, indirizzi (anti-IDOR), profilo pubblico, segui/blocca, preferenze notifiche, eliminazione account (step-up), autocompletamento comuni, registro consensi cookie.
5. Web: client Better Auth, pagine `/accedi` (password, passkey, 2FA), `/registrati`, `/verifica-email`, `/password-dimenticata`, `/reimposta-password`, `/account`, impostazioni (profilo, indirizzi, sicurezza: password/2FA/passkey/sessioni, notifiche, privacy), profilo pubblico `/utente/[username]`, banner cookie (Garante), pagine legali MDX segnaposto.
6. Test: integrazione API (Testcontainers) per `STEP_UP_REQUIRED` e anti-IDOR; e2e Playwright registrazione → verifica email (Mailpit) → login → 2FA → login con TOTP; test "nessun analytics prima del consenso".

**Fatto**
- API: Better Auth 1.7 su `/api/auth/*` (email+password, verifica email obbligatoria, reset, Google opzionale, 2FA TOTP con codici di backup, passkey, ruoli, Turnstile, limiti su Valkey); guard globale (sessione, email verificata, Origin, ruoli + 2FA staff, impersonificazione in sola lettura); dispositivi riconosciuti, avviso di nuovo accesso, step-up con password e/o codice email; `/me`, indirizzi, profilo pubblico e annunci, segui/blocca, preferenze notifiche, eliminazione account; autocompletamento comuni; registro consensi.
- Email: 5 template React Email in italiano, invio SMTP (Mailpit).
- Web: pagine `/accedi` (password, passkey, Google, 2FA/backup), `/registrati`, `/verifica-email`, `/password-dimenticata`, `/reimposta-password`, `/account` con impostazioni (profilo con comune, indirizzi, sicurezza: password, 2FA con QR, passkey, dispositivi; notifiche; privacy), `/utente/[username]` SSR, banner cookie, pagine legali MDX, 404. Proxy con redirect dell'area privata.
- Test: integrazione API (Testcontainers PostgreSQL + Valkey) per `STEP_UP_REQUIRED` (dispositivo nuovo e autenticazione vecchia, anche su `/change-password`), anti-IDOR sugli indirizzi, Origin, termini obbligatori, utenti non verificati; e2e Playwright: registrazione → verifica email da Mailpit → accesso → attivazione 2FA → nuovo accesso con TOTP; redirect dell'area privata; nessuno script di analytics prima del consenso.
- Credenziali demo: tutti gli utenti demo hanno la password `accordo-demo-2026`.
- Decisioni: ADR-0018…0023.

**Rimandato**
- Esportazione GDPR (Fase 11), revoca automatica dal link "Non sono stato io" e limite di login per account (Fase 12), e2e in CI (Fase 12), notifiche push (dopo l'MVP).
