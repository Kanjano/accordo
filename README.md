# Accordo

Marketplace italiano di strumenti musicali con pagamento protetto e feedback verificati. Specifica completa: [`SPEC.md`](SPEC.md). Avanzamento: [`docs/PROGRESS.md`](docs/PROGRESS.md).

## Requisiti

Node.js 26 (`.nvmrc`; consigliato [fnm](https://github.com/Schniz/fnm)), pnpm 12, Docker.

## Avvio in 5 comandi

```bash
fnm use                 # Node 26
cp .env.example .env
pnpm install
pnpm infra:up           # PostgreSQL, Valkey, Meilisearch, RustFS (S3), Mailpit
pnpm dev                # web :3000, API :4000, worker
```

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
pnpm test          # Vitest
pnpm build
pnpm infra:down
```
