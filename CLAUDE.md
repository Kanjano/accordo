# CLAUDE.md

Marketplace di strumenti musicali (codename `accordo`). La specifica è `SPEC.md`; l'avanzamento è in `docs/PROGRESS.md`; le deviazioni in `docs/DECISIONS.md` (ADR).

## Comandi

- Node 26 via fnm: `fnm use` (oppure anteponi `~/.local/share/fnm/node-versions/v26.*/installation/bin` al PATH). pnpm 12.
- `pnpm infra:up` / `pnpm infra:down` — servizi Docker (`infra/compose/docker-compose.yml`, legge `.env`).
- `pnpm dev` — web :3000, API :4000, worker (Turbo compila prima i `packages/*`).
- `pnpm lint && pnpm typecheck && pnpm test && pnpm build` — devono essere verdi a fine fase.
- `pnpm --filter @accordo/<pkg> <script>` per un singolo pacchetto.
- Nuove dipendenze con script di build: aggiungerle ad `allowBuilds` in `pnpm-workspace.yaml`, altrimenti `pnpm add` fallisce.

## Struttura

- `apps/web` Next.js 16 App Router, `app/[locale]`, next-intl (`messages/it.json`), `proxy.ts`.
- `apps/api` NestJS 12 ESM; moduli in `src/modules/<modulo>/`; env in `src/config/env.ts`.
- `apps/worker` NestJS standalone + BullMQ.
- `packages/` `db` `domain` `shared` `sdk` `ui` `emails` `config` — compilati in `dist/` con `tsc`.
- `infra/compose`, `docs/`, `.github/workflows/ci.yml`.

## Regole di lavoro

1. Si lavora per fasi (SPEC §16). Fine fase: lint, typecheck, test verdi, `docs/PROGRESS.md` aggiornato, commit convenzionale (`feat:`, `fix:`, `chore:`), riepilogo, **stop** in attesa di conferma.
2. Prima di una fase: rileggere le sezioni SPEC richiamate e scrivere il piano in `docs/PROGRESS.md`.
3. Versioni: ultime **stabili** (`npm view <pkg> dist-tags`), versioni esatte. Prisma: `prisma@7`/`@prisma/client@7` (latest è RC). TypeScript 6.0.x (non 7).
4. Documentazione ufficiale prima di tutto; deviazioni → ADR in `docs/DECISIONS.md`.
5. Ambiguità: opzione più semplice e sicura + ADR. Chiedere solo per decisioni irreversibili o denaro reale.
6. Codice, identificatori, commenti, commit in **inglese**; testi UI in **italiano** via i18n, nessuna stringa visibile hard-coded.
7. Denaro: centesimi interi (`Int`) con valuta `EUR`, mai float. Operazioni di denaro idempotenti, transazionali, nel ledger, testate.
8. Segreti mai nel repo; `.env` è ignorato, `.env.example` è completo.
9. Niente copia o scraping del sito di riferimento; dati demo generati (Faker `it`).
10. TypeScript `strict`, niente `any`, test per la logica di dominio, WCAG 2.2 AA, zero errori in console.
11. Errori API in Problem Details (RFC 9457) con `code` stabile (`ProblemDetailsFilter`; passa `{ code, detail }` alle `HttpException`).
12. Nest DI: non convertire in `import type` le classi iniettate (Biome `useImportType` è disattivato apposta).

## Regole d'oro del dominio

- Lo stato di un ordine cambia **solo** tramite `OrderStateMachine` (§6.4) e `OrdersService.transition()`; mai `update` diretti sulla colonna `status`.
- Nessun modulo chiama Stripe o il provider di spedizioni direttamente: si passa dalle porte `PaymentProvider` / `ShippingProvider` (§5.4).
- Ogni scrittura che deve generare effetti esterni (email, indicizzazione, trasferimenti) scrive un evento nella tabella outbox **nella stessa transazione** (§5.4).
- Il feedback si può lasciare solo su ordini `COMPLETED` (§8).
