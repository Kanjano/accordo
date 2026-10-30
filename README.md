# Accordo

Marketplace italiano di strumenti musicali con pagamento protetto e feedback verificati. Specifica completa: [`SPEC.md`](SPEC.md). Avanzamento: [`docs/PROGRESS.md`](docs/PROGRESS.md).

## Requisiti

Node.js 26 (`.nvmrc`; consigliato [fnm](https://github.com/Schniz/fnm)), pnpm 12, Docker.

## Avvio

```bash
fnm use                 # Node 26
cp .env.example .env
pnpm install
pnpm infra:up           # PostgreSQL, Valkey, Meilisearch, RustFS (S3), Mailpit
pnpm db:deploy          # applica le migrazioni
pnpm db:seed            # catalogo, comuni, festività, impostazioni + dati demo (sviluppo)
pnpm dev                # web :3000, API :4000, worker
```

Per gli e2e serve una volta `npx playwright install chromium`.

| Servizio       | URL                                              |
| -------------- | ------------------------------------------------ |
| Web            | http://localhost:3000                            |
| API readiness  | http://localhost:4000/health/ready               |
| Mailpit        | http://localhost:8025                            |
| Meilisearch    | http://localhost:7700                            |
| RustFS console | http://localhost:9001 (accordo / accordo-secret) |

## Comandi

```bash
pnpm lint          # Biome
pnpm typecheck
pnpm test          # Vitest (unit; packages/domain con soglia di copertura 95%)
pnpm test:integration  # Testcontainers: richiede Docker
pnpm test:e2e      # Playwright (richiede infra:up; avvia o riusa pnpm dev)
pnpm build
pnpm infra:down
```

## Dati demo

`pnpm db:seed` in sviluppo crea 60 utenti (`admin@accordo.local`, `moderatore@accordo.local`, `supporto@accordo.local`, `negozio@accordo.local`, `utente@accordo.local`, …), 2.000 annunci e ordini in ogni stato. Password di tutti gli utenti demo: `accordo-demo-2026`. Lo staff dovrà attivare la 2FA per il backoffice. Codice di consegna a mano degli ordini demo: `123456`. Solo per sviluppo.

Dati geografici: ISTAT (CC BY 4.0) e Wikidata (CC0), vedi `docs/DATA_SOURCES.md`.
