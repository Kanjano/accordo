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

## Spedizioni (Fase 7)

```mermaid
flowchart LR
  WK[Worker coda payments: CREATE_SHIPPING_LABEL] --> SP[ShippingProvider: mock | sendcloud]
  WK -- PDF --> S3[(Bucket privato)]
  SP -- webhook HMAC --> API[API /webhooks/shipping/:provider]
  API -- WebhookEvent + outbox --> PG[(PostgreSQL)]
  PG --> WS[Worker coda shipping]
  WS -- SHIPMENT_CONFIRMED / DELIVERED via applyOrderEvent --> PG
```

## Deploy (Fase 12)

```mermaid
flowchart LR
  U[Browser / PWA] -->|HTTPS| C[Caddy: TLS automatico]
  C -->|dominio| W[web: Next.js standalone, CSP con nonce]
  C -->|api.dominio| A[api: NestJS + Better Auth + Socket.IO]
  C -->|s3.dominio| S3[(storage S3: media e upload firmati)]
  W -->|SSR, rete interna| A
  A --> PG[(PostgreSQL: accordo_app)]
  A --> V[(Valkey: sessioni, limiti, BullMQ)]
  A --> M[(Meilisearch)]
  K[worker: BullMQ, outbox, sweeper] --> PG
  K --> V
  K --> M
  K --> S3
  MG[migrate: prisma migrate deploy + seed base, accordo_migrator] --> PG
  B[backup: pg_dump giornaliero] --> PG
```

- Immagini da un solo `Dockerfile` multi-stage (target `web`, `api`, `worker`, `migrate`), con utente non root e `HEALTHCHECK`. Per il worker l'healthcheck controlla il file dell'heartbeat.
- Rilascio: CI verde, poi immagini su GHCR, `migrate` e infine `up -d` (`.github/workflows/deploy-staging.yml`, `docs/RUNBOOK.md`).
- Prestazioni misurate:
  - pagina annuncio: 176 KB di JavaScript compresso, LCP 0,6 s su 4G simulato;
  - ricerca: p95 di 18 ms a 200 richieste al secondo;
  - pagina annuncio: 100 richieste al secondo senza errori;
  - seed da circa 100.000 annunci.
