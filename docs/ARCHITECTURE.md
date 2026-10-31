# Architettura

Panoramica completa: SPEC.md §5. Stato attuale (Fase 0):

- `apps/web` — Next.js 16 (App Router), next-intl (`it` predefinito senza prefisso, `en` sotto `/en`), Tailwind 4, token shadcn/ui da `@accordo/ui/styles.css`.
- `apps/api` — NestJS 12 (Express, ESM). `ConfigModule` (env validato con Zod), `PlatformModule` (health, filtro Problem Details, bootstrap bucket in sviluppo). Prefisso REST `/api/v1`; health su `/health/live` e `/health/ready`.
- `apps/worker` — NestJS standalone + BullMQ; job ricorrente `heartbeat`.
- `packages/*` — librerie TypeScript compilate in `dist/` con `tsc`; Turborepo compila le dipendenze prima di `dev`, `typecheck`, `test`, `build`.

- `packages/search` — impostazioni Meilisearch, documento, traduzione dei parametri, reindicizzazione (usato da API, worker e `scripts/`).

## Flusso degli eventi (Fasi 3–4)

```mermaid
flowchart LR
  API[API: scrittura + OutboxEvent nella stessa transazione] --> PG[(PostgreSQL)]
  PG --> D[Worker: dispatcher outbox, SKIP LOCKED]
  D -->|media.*| QM[coda media]
  D -->|listing.price_dropped, listing.review_pending| QN[coda notifications]
  D -->|listing.*| QS[coda search-index]
  QS --> MS[(Meilisearch: listings, brands, categories)]
  SA[saved-search-alerts: ogni 10 min + 8:00] --> MS
  SA --> N
  QM --> MP[MediaProcessor: sharp, varianti, dHash]
  MP --> S3[(S3 pubblico)]
  QN --> N[Notifier: in-app + email]
  L[LifecycleProcessor orario] --> PG
  L --> N
```

## Ricerca (Fase 4)

```mermaid
flowchart LR
  W[Web SSR /annunci, /categoria, /marca] --> A[API GET /search/listings]
  A -->|ok| MS[(Meilisearch)]
  A -->|errore o timeout 1,5 s| PG[(PostgreSQL: ILIKE + pg_trgm)]
  R[pnpm search:reindex] -->|indice _next + swapIndexes| MS
```

## Messaggi e realtime (Fase 5)

```mermaid
flowchart LR
  B[Browser] -- Socket.IO /ws, cookie di sessione --> GW[API RealtimeGateway]
  GW <--> R[(Redis adapter)]
  WK[Worker: notifiche, scadenze offerte] -- redis-emitter --> R
  B -- REST --> API[API messaging: scanMessage, offerte] --> PG[(PostgreSQL + outbox)]
  API -- dopo il commit --> GW
```

## Ordini e pagamenti (Fase 6)

```mermaid
flowchart LR
  W[Web checkout] -- POST /orders + Idempotency-Key --> API
  API -- PaymentIntent --> P[PaymentProvider: fake | stripe]
  P -- webhook firmato --> API
  API -- WebhookEvent + outbox --> PG[(PostgreSQL)]
  PG --> WK[Worker coda payments]
  WK -- applyOrderEvent --> PG
  WK -- transfer source_transaction / refund --> P
  SW[Sweeper ogni minuto] -- applyOrderEvent --> PG
  N[Controlli notturni: ledger, fondi trattenuti] --> PG
```
