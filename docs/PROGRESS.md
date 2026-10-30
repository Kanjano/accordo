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
