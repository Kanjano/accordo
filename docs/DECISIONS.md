# Decisioni (ADR)

Formato: contesto → decisione → conseguenze.

## ADR-0001 — Toolchain locale: fnm, Node 26, pnpm 12 (2026-10-30)

- **Contesto:** la macchina di sviluppo aveva Node 23; corepack 0.32 non riesce ad avviare pnpm 12.
- **Decisione:** Node 26 tramite `fnm` (legge `.nvmrc`); pnpm 12 installato globalmente con npm. pnpm 12 blocca gli script di build non approvati: l'elenco è in `allowBuilds` dentro `pnpm-workspace.yaml`.
- **Conseguenze:** una dipendenza nuova con script di build fa fallire `pnpm add` finché non viene aggiunta ad `allowBuilds` (true/false).

## ADR-0002 — Pacchetti interni compilati in `dist/`

- **Contesto:** API e worker girano con Node su JS compilato; i decorator di Nest non sono supportati dal type stripping nativo.
- **Decisione:** ogni `packages/*` compila con `tsc` in `dist/`; in `dev` gira `tsc --watch`; Turborepo esegue `^build` prima di `dev`/`typecheck`/`test`/`build`.
- **Conseguenze:** un clone pulito richiede la build dei pacchetti, già automatica tramite Turbo.

## ADR-0003 — Worker con configurazione propria (per ora)

- **Contesto:** la SPEC prevede che il worker riusi i moduli dell'API. In Fase 0 il worker usa solo Valkey e il logger.
- **Decisione:** schema env minimo nel worker; il meccanismo di condivisione dei moduli API ↔ worker si decide nella prima fase che ne ha bisogno (outbox, Fase 3/4).
- **Conseguenze:** piccola duplicazione (schema env, config logger) da eliminare in quella fase.

## ADR-0004 — Validazione env incrementale

- **Decisione:** lo schema Zod dell'API valida solo le variabili effettivamente usate; ogni fase aggiunge quelle che consuma. `.env.example` è già completo (SPEC §17.1) più `API_PORT` e `HEARTBEAT_EVERY_MS`.

## ADR-0005 — Readiness del database con `pg` fino alla Fase 1 (superata in Fase 1)

- **Decisione:** `/health/ready` interroga PostgreSQL con un pool `pg` minimo; in Fase 1 passa al client Prisma con `@prisma/adapter-pg`.

## ADR-0006 — Versioni fissate

- Immagini Docker fissate: `postgres:18.6`, `valkey/valkey:8.1.11-alpine`, `getmeili/meilisearch:v1.56.0`, `rustfs/rustfs:1.0.4`, `axllent/mailpit:v1.32.0`, `stripe/stripe-cli:v1.55.3`.
- TypeScript 6.0.3 (il tag `latest` npm è 7.x: non supportato dalla CLI Nest, vedi SPEC §4).

## ADR-0007 — CSP e header di sicurezza in Fase 12

- **Decisione:** `proxy.ts` gestisce per ora solo l'i18n; CSP con nonce e header di sicurezza arrivano con l'hardening (Fase 12, SPEC §13.6).

## ADR-0008 — SDK scritto a mano sopra i contratti Zod

- **Decisione:** `packages/sdk` è un client `fetch` tipizzato con i contratti di `@accordo/shared` (opzione prevista da SPEC §5.4.7). La generazione OpenAPI si valuta quando ci sono endpoint di dominio.

## ADR-0009 — Prisma 7: opzioni del generator e indici

- **Decisione:** generator `prisma-client` con `moduleFormat = "esm"` e `importFileExtension = "js"` (richiesti da `module: nodenext`). Gli indici GIN del §10.2 (`Listing_title_trgm`, `Listing_attributes_gin`) sono creati nella migrazione SQL **e** dichiarati nello schema con `map:`, altrimenti `migrate dev` genererebbe un `DROP INDEX`. L'indice unico parziale `Order_one_active_per_listing` e i `CHECK` esistono solo in SQL: Prisma li ignora (verificato con `prisma migrate diff`).
- **Conseguenze:** dopo ogni modifica allo schema controllare che la migrazione generata non tocchi questi oggetti.

## ADR-0010 — Id UUIDv7 generati da Prisma, non dal database

- **Contesto:** il §10.1 usa `@default(uuid(7))`, che Prisma valorizza lato client; il testo parla di id "generati dal database".
- **Decisione:** mantengo lo schema della SPEC (id generati dal client Prisma). Con Better Auth (Fase 2) si disattiva la sua generazione di id così che li produca Prisma. Il seed demo pre-genera alcuni id con `crypto.randomUUID()` (v4) per `createMany`.
- **Conseguenze:** l'allineamento dei modelli Better Auth con `@better-auth/cli generate` avviene in Fase 2.

## ADR-0011 — Fonti geografiche

- ISTAT (CC BY 4.0) per l'anagrafica, Wikidata (CC0) per coordinate e CAP. Dettagli in `DATA_SOURCES.md`.

## ADR-0012 — Chiavi degli attributi e regole di reputazione non specificate

- **Attributi:** `AttributeDefinition.key` è univoca ma il §19.2 riusa chiavi con valori diversi. Chiavi distinte dove i valori divergono: `acousticBodyShape`, `bassStrings`, `guitarSize` (classiche), `size` (archi), `stringCaseIncluded` (archi, booleano; `caseIncluded` resta l'enum delle chitarre).
- **Venditore Top:** la percentuale di cancellazioni è calcolata su vendite completate + cancellazioni imputabili al venditore. La media DSR è la media di tutte le valutazioni dettagliate (tutti i criteri) con almeno 10 valutazioni.
- **Livelli:** chiavi `NEWCOMER` (Esordiente), `SESSION_PLAYER` (Turnista), `SOLOIST`, `PROFESSIONAL`, `MAESTRO`, `LEGEND`.
- **Deduplicazione feedback:** conta il primo feedback _pubblicato_ del gruppo (autore, destinatario, ruolo, settimana ISO in Europe/Rome); se viene rimosso, conta il successivo.
- **Revisioni:** la nuova valutazione può essere uguale o migliore, mai peggiore.

## ADR-0013 — Seed

- `pnpm db:seed`: seed di base idempotente (upsert; le `PlatformSetting` esistenti non vengono mai sovrascritte) più dati demo se `NODE_ENV=development`. `pnpm db:seed:demo` forza i dati demo; in produzione sono vietati.
- I dati demo vengono saltati se `admin@accordo.local` esiste già. Gli ordini demo sono generati facendo passare ogni ordine per la vera `transition()`, con ledger, rimborsi, spedizioni ed eventi coerenti.
- Gli utenti demo non hanno ancora una password: le credenziali arrivano con Better Auth in Fase 2. Il codice di consegna a mano degli ordini demo è `123456`.

## ADR-0014 — Temporal per i calendari

- Node 26 include `Temporal`: `packages/domain` lo usa per giorni lavorativi, settimane ISO e anno dei numeri d'ordine in Europe/Rome (corretto anche al cambio dell'ora). L'API pubblica del dominio usa `Date`.

## ADR-0015 — Macchina a stati: dettagli

- Le condizioni che dipendono da altri moduli arrivano nell'evento (`CHECKOUT_STARTED.guards`, `BUYER_CONFIRMED_RECEIPT.stepUpVerified`): impossibile dimenticarle.
- `estimatedDeliveryAt` nel patch appartiene a `Shipment`, non a `Order`.
- Dallo stato `DELIVERED` non si può aprire una controversia "non ricevuto".
- Le scadenze `DISPUTE_*` sono gestite dal modulo controversie (Fase 8): `sweeperStep` restituisce `null`.

## ADR-0016 — pnpm 12: età minima dei rilasci

- pnpm 12 applica `minimumReleaseAge`; per le versioni installate esplicitamente e più recenti della soglia aggiunge da solo `minimumReleaseAgeExclude` in `pnpm-workspace.yaml`. Le voci vanno ripulite quando i pacchetti invecchiano.

## ADR-0017 — `prisma migrate reset` da agenti AI

- Prisma 7 blocca `migrate reset` quando lo lancia un agente AI, salvo consenso esplicito dell'utente (variabile `PRISMA_USER_CONSENT_FOR_DANGEROUS_AI_ACTION`). Claude Code chiede sempre prima di resettare, e solo sul database locale.
