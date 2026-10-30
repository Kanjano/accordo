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

## ADR-0005 — Readiness del database con `pg` fino alla Fase 1

- **Decisione:** `/health/ready` interroga PostgreSQL con un pool `pg` minimo; in Fase 1 passa al client Prisma con `@prisma/adapter-pg`.

## ADR-0006 — Versioni fissate

- Immagini Docker fissate: `postgres:18.6`, `valkey/valkey:8.1.11-alpine`, `getmeili/meilisearch:v1.56.0`, `rustfs/rustfs:1.0.4`, `axllent/mailpit:v1.32.0`, `stripe/stripe-cli:v1.55.3`.
- TypeScript 6.0.3 (il tag `latest` npm è 7.x: non supportato dalla CLI Nest, vedi SPEC §4).

## ADR-0007 — CSP e header di sicurezza in Fase 12

- **Decisione:** `proxy.ts` gestisce per ora solo l'i18n; CSP con nonce e header di sicurezza arrivano con l'hardening (Fase 12, SPEC §13.6).

## ADR-0008 — SDK scritto a mano sopra i contratti Zod

- **Decisione:** `packages/sdk` è un client `fetch` tipizzato con i contratti di `@accordo/shared` (opzione prevista da SPEC §5.4.7). La generazione OpenAPI si valuta quando ci sono endpoint di dominio.
