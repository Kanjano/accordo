# Runbook

Procedure operative (SPEC §15.4). Deploy di riferimento: una VM con `infra/compose/docker-compose.prod.example.yml` (Caddy, web, API, worker, PostgreSQL, Valkey, Meilisearch, storage S3, backup). Comandi da `/opt/accordo` sulla VM:

```bash
alias dc='docker compose -f docker-compose.prod.example.yml --env-file .env.prod'
```

## Ambienti

| Ambiente   | Pagamenti              | Spedizioni        | Dati                              |
| ---------- | ---------------------- | ----------------- | --------------------------------- |
| Locale     | `fake` (o Stripe test) | `mock`            | seed demo                         |
| Staging    | Stripe **test**        | Sendcloud sandbox | solo seed di base + dati di prova |
| Produzione | Stripe **live**        | Sendcloud live    | reali                             |

Le chiavi live esistono solo nel `.env.prod` di produzione. I dati demo non vanno mai in staging o produzione: con `NODE_ENV=production` il seed si rifiuta di crearli.

## Deploy

1. La CI è verde su `main`, poi il workflow `Deploy staging` costruisce le immagini (`web`, `api`, `worker`, `migrate`) su GHCR. Il workflow parte solo con la variabile di repository `STAGING_ENABLED=true` (environment `staging` con dominio, chiavi e segreti SSH già configurati).
2. **Migrazioni prima del rollout:** `dc run --rm migrate` (`prisma migrate deploy` e seed di base, con l'utente delle migrazioni).
3. Rollout: `dc up -d --no-build`. Caddy continua a servire mentre i container ripartono; il compose aspetta l'healthcheck dell'API prima di avviare il web.
4. Verifica: `dc ps` (tutti `healthy`), `curl https://api.<dominio>/health/ready`, accesso e ricerca dal sito.

Le migrazioni devono restare compatibili con la versione precedente dell'app (espandi, poi contrai in un rilascio successivo). Le funzioni rischiose stanno dietro un'impostazione o una variabile (`PAYMENT_PROVIDER`, `SHIPPING_PROVIDER`, `dac7.blockPayoutsWithoutProfile`).

**Rollback:** `docker tag ghcr.io/<repo>/<target>:<sha-precedente> accordo-<target>` per ogni immagine, poi `dc up -d --no-build`. Le migrazioni non si annullano: si corregge con una nuova migrazione.

### Prima installazione

1. VM con Docker; DNS `A` per `<dominio>`, `api.<dominio>`, `s3.<dominio>`; porte 80 e 443 aperte.
2. Copiare in `/opt/accordo` il compose, `caddy/` e `postgres/`; creare `.env.prod` da `prod.env.example` con segreti nuovi (`openssl rand -base64 32`).
3. `dc up -d`: al primo avvio `postgres/init-roles.sh` crea `accordo_migrator` (proprietario dello schema) e `accordo_app` (solo dati; nessun UPDATE o DELETE su `AuditLog`).
4. Creare gli indici di ricerca: `dc run --rm migrate pnpm search:reindex`.

## Backup e ripristino

- **Dump logico giornaliero:** il servizio `backup` scrive `accordo-AAAA-MM-GG.dump` nel volume `backups` e tiene 14 giorni. Il volume va copiato ogni giorno su uno storage **separato** (bucket di un altro provider o di un altro account).
- **PITR (RPO ≤ 5 minuti):** con PostgreSQL gestito, attivare il point-in-time recovery del provider. Su VM: archiviazione WAL con pgBackRest o WAL-G verso lo storage separato (`archive_mode=on`, `archive_timeout=60`), backup base settimanale.
- **Media:** versioning attivo sul bucket pubblico e su quello privato; regola di ciclo di vita per le versioni vecchie oltre 30 giorni.
- **Meilisearch** non si salva: si ricostruisce dal database.
- **Valkey** (code BullMQ) usa `appendonly`: in caso di perdita gli outbox non ancora spediti ripartono dal database; i job pianificati si ricreano all'avvio del worker.

### Test di ripristino (mensile, da registrare in fondo a questo file)

```bash
docker run -d --name restore-test -e POSTGRES_PASSWORD=x postgres:18.6
docker cp accordo-AAAA-MM-GG.dump restore-test:/tmp/
docker exec restore-test sh -c 'createdb -U postgres accordo && pg_restore -U postgres -d accordo --no-owner /tmp/accordo-*.dump'
docker exec restore-test psql -U postgres -d accordo -c 'select count(*) from "Order"; select max("createdAt") from "AuditLog";'
docker rm -f restore-test
```

Esito atteso: nessun errore di `pg_restore`, conteggi coerenti con la produzione, ultimo audit dell'ora del dump. Per il PITR: ripristino a un orario preciso in un'istanza separata, stesso controllo.

## Incidenti

### Webhook in errore

- **Sintomi:** alert `ALERT` nei log del worker dopo 5 tentativi; voci in errore su `/admin/webhook`; ordini fermi in `CHECKOUT_PENDING` con il pagamento riuscito su Stripe.
- **Azioni:** leggere l'errore della voce. Se la causa è un bug, correggere e rilasciare, poi **Rielabora** dal pannello (l'elaborazione è idempotente). Se la firma fallisce, controllare `STRIPE_WEBHOOK_SECRET` / `SHIPPING_WEBHOOK_SECRET` e l'endpoint configurato nella Dashboard. Gli eventi Stripe persi si reinviano dalla Dashboard (Developers → Events → Resend).

### Code bloccate

- **Sintomi:** Bull Board (`https://api.<dominio>/admin/queues`, staff con 2FA) mostra job in attesa da oltre 5 minuti; il worker non è `healthy` (heartbeat fermo da 3 minuti).
- **Azioni:**
  - Controllare `dc logs worker` e `dc ps`.
  - Riavviare: `dc restart worker`; i job in corso vengono ripresi.
  - Job falliti per un bug: correggere, poi "Retry" da Bull Board.
  - Valkey pieno o giù: `dc logs valkey`. Con `noeviction` le scritture falliscono, quindi va liberata memoria o aumentata.

### Meilisearch giù (modalità degradata)

- La ricerca risponde con `degraded: true` usando PostgreSQL: funziona, ma è più lenta e senza tolleranza agli errori di battitura. Il sito resta su.
- **Azioni:** `dc restart meilisearch`. Se l'indice è perso o corrotto: `dc run --rm migrate pnpm search:reindex`, che crea un indice nuovo e lo scambia in modo atomico. Gli aggiornamenti persi nel frattempo vengono recuperati dalla reindicizzazione.

### Provider di spedizione giù

- **Sintomi:** etichette non create (job `CREATE_SHIPPING_LABEL` in errore nella coda `payments`) ed eventi di tracking assenti.
- **Azioni:**
  - I job riprovano con backoff; se l'interruzione è lunga, disattivare temporaneamente la spedizione integrata. Con `SHIPPING_PROVIDER=mock` in staging si può provare il flusso.
  - Ordini già pagati: il termine di spedizione è di 5 giorni lavorativi. Se l'interruzione lo minaccia, il supporto contatta i venditori. Gli annullamenti causati dal provider vanno trattati come concordati, senza penalità per il venditore.

### Altro

- Fondi trattenuti oltre 60 giorni (alert notturno): risolvere l'ordine. Oltre 85 giorni il supporto deve completarlo o rimborsarlo (limite Stripe 90 giorni).
- Differenze di riconciliazione: `/admin` (dashboard) e log del controllo notturno delle 03:30.

## Rotazione delle chiavi

| Segreto                  | Procedura                                                                                                                                                                                               | Effetto                                                                                                               |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `BETTER_AUTH_SECRET`     | nuovo valore, riavvio di API e worker                                                                                                                                                                   | tutte le sessioni e i link nelle email (verifica, reset, "Non sono stato io") diventano invalidi; avvisare gli utenti |
| `DEVICE_COOKIE_SECRET`   | nuovo valore, riavvio dell'API                                                                                                                                                                          | i dispositivi tornano "nuovi": email di avviso al prossimo accesso                                                    |
| `HANDOVER_CODE_PEPPER`   | **non ruotare con ordini `HANDOVER_PENDING` aperti** (i codici non tornerebbero più)                                                                                                                    | nessuno se non ci sono consegne in corso                                                                              |
| `ENCRYPTION_KEY`         | oggi c'è una sola chiave attiva: aggiungere il supporto a più chiavi (decifratura con la chiave indicata da `keyId`), cambiare `ENCRYPTION_KEY_ID`, ricifrare i `TaxProfile` con un job (vedi ADR-0047) | rimandato: va fatto prima della prima rotazione                                                                       |
| `STRIPE_*`, `SHIPPING_*` | crea la nuova chiave dalla dashboard del provider, aggiorna `.env.prod`, riavvia, revoca la vecchia                                                                                                     | nessuno                                                                                                               |
| `MEILI_MASTER_KEY`       | nuovo valore per Meilisearch, API e worker, poi riavvio                                                                                                                                                 | nessuno                                                                                                               |
| Password del database    | `ALTER ROLE … PASSWORD` con il superuser, aggiorna `.env.prod`, riavvio                                                                                                                                 | nessuno                                                                                                               |

## Violazione dei dati (data breach)

1. **Contenere:** revocare le credenziali compromesse (tabella sopra) e chiudere l'accesso, anche mettendo il sito in manutenzione con una pagina statica di Caddy. Conservare log e snapshot: niente cancellazioni.
2. **Valutare** entro 24 ore quali dati sono coinvolti, quanti interessati e con quale rischio. Fonti: `AuditLog`, log dell'API (con `requestId`), log del provider. I dati fiscali sono cifrati: conta se la chiave è stata esposta.
3. **Notificare il Garante** entro **72 ore** dalla scoperta (art. 33 GDPR, modulo online), salvo rischio improbabile, che va comunque documentato.
4. **Comunicare agli interessati** senza ritardo se il rischio è elevato (art. 34). Il testo dice cosa è successo, quali dati sono coinvolti, cosa fare (per esempio cambiare la password) e indica un contatto.
5. **Informare** Stripe e il provider di spedizioni se sono coinvolti i loro dati o le loro chiavi.
6. **Registrare** l'incidente nel registro delle violazioni (anche se non notificato) e scrivere una revisione post-incidente con le azioni correttive.

## Prestazioni e carico

```bash
pnpm build
(cd apps/api && NODE_ENV=production RATE_LIMIT_ENABLED=false LOG_LEVEL=warn node dist/main.js) &
(cd apps/web && pnpm exec next start) &
pnpm perf:budget   # LCP, CLS (mobile 4G simulato) e JS della pagina annuncio < 180 KB compressi
pnpm load:test     # k6 in Docker: ricerca 200 req/s (p95 < 300 ms), pagina annuncio 100 req/s
```

Il carico va fatto sul seed da 100.000 annunci (`pnpm db:seed:big && pnpm search:reindex`) e mai in produzione. `RATE_LIMIT_ENABLED=false` serve solo qui: altrimenti i 60 req/min per IP della ricerca anonima fermano k6.

## Registro dei test di ripristino

| Data | Backup usato | Esito                        | Chi |
| ---- | ------------ | ---------------------------- | --- |
| —    | —            | da eseguire prima del lancio | —   |
