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

## ADR-0003 — Worker con configurazione propria (superata da ADR-0024)

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

## ADR-0018 — Allineamento a Better Auth 1.7

- `npx @better-auth/cli generate` è fermo alla 1.4: lo schema atteso è stato letto con `getAuthTables()` della versione installata. Differenza: `TwoFactor` ha tre campi in più (`verified`, `failedVerificationCount`, `lockedUntil`), aggiunti con la migrazione `better_auth_two_factor`. Better Auth verifica lo schema all'avvio e blocca le richieste se non coincide.
- Id generati da Prisma (`advanced.database.generateId: false`, ADR-0010).
- Plugin attivi: admin, username, twoFactor, passkey, captcha. `phoneNumber` resta predisposto nello schema ma non è montato (MVP).
- Campi aggiuntivi dell'utente: `termsAcceptedAt`, `marketingConsentAt` (solo lato server, dal body della registrazione). Gli utenti Google ricevono uno username generato.

## ADR-0019 — Email di autenticazione inviate direttamente

- Le email di Better Auth (verifica, reset, nuovo dispositivo, password cambiata) e il codice di step-up partono dall'API tramite la porta `EmailProvider`, senza outbox: non dipendono da una transazione di dominio e sono sensibili al tempo. Le notifiche di dominio passeranno dall'outbox (Fase 3+).
- Solo l'adapter SMTP (Mailpit in sviluppo); il provider di produzione UE si aggiunge prima del lancio.

## ADR-0020 — Better Auth montato su Express, non tramite `@thallesp/nestjs-better-auth`

- **Decisione:** `toNodeHandler(auth)` su `/api/auth/{*path}` prima del parser JSON (Better Auth legge il corpo grezzo); guard globale Nest scritto in casa (`AuthGuard`) con decorator `@Public`, `@AllowUnverified`, `@Roles`, `@RequireStepUp`, `@CurrentAuth`.
- **Motivo:** meno dipendenze, compatibilità certa con Nest 12, controllo su Origin, impersonificazione in sola lettura e step-up.
- La validazione usa `StandardSchemaValidationPipe` di Nest 12 con gli schemi Zod di `@accordo/shared` (`@Body({ schema })`).

## ADR-0021 — Step-up e dispositivi riconosciuti

- Cookie `accordo_device` firmato (HMAC con `DEVICE_COOKIE_SECRET`), salvato solo come SHA-256 in `KnownDevice`; impostato da un hook `after` di Better Auth su ogni nuova sessione.
- Step-up richiesto se l'ultima autenticazione (creazione della sessione o ultimo step-up) ha più di `STEP_UP_MAX_AGE_MINUTES`, oppure se il dispositivo è stato visto per la prima volta da meno di 24 ore: in quel caso serve anche un codice email (6 cifre, hash in Valkey, 10 minuti, 5 tentativi). Chi non ha password usa solo il codice email.
- Stato dello step-up in Valkey per sessione (`stepup:{sessionId}`). Risposta `401 STEP_UP_REQUIRED` con `requires: ["password" | "email_code"]`, anche sui percorsi di Better Auth (`/change-password`, `/change-email`, `/two-factor/disable`, `/passkey/delete-passkey`) tramite hook `before`.
- Il link "Non sono stato io" dell'email di nuovo accesso porta alla pagina Sicurezza (esci dagli altri dispositivi, cambia password); revoca automatica rimandata (da rivedere in Fase 12).

## ADR-0022 — Limiti di frequenza e captcha

- Limiti di Better Auth (login 5/min, registrazione 3/ora, reset 3/ora, verifica 2FA 5/min per IP) con storage atomico su Valkey; `RATE_LIMIT_ENABLED=false` solo per test ed e2e. Il limite "10/ora per account" sul login è rimandato alla revisione di sicurezza (Fase 12).
- Turnstile su registrazione e richiesta di reset password (chiavi di test in `.env.example`). Sul login non c'è captcha: lo protegge il limite per IP. Senza chiave segreta il plugin protegge un percorso fittizio, perché una lista vuota significa "endpoint predefiniti".

## ADR-0023 — Frontend: componenti, consenso, pagine legali

- `packages/ui`: componenti in stile shadcn scritti a mano su elementi HTML nativi (Button, Input, Field con `aria-describedby`/`aria-live`, Card, Alert), senza Radix finché non serve.
- `next.config.ts` carica il `.env` della radice e deriva le variabili pubbliche (`NEXT_PUBLIC_API_URL` da `API_URL`, ecc.).
- Banner cookie conforme alle linee guida del Garante: Accetta e Rifiuta equivalenti, X = rifiuto, scelte granulari non preselezionate, scelta valida 6 mesi, registro in `AuditLog` (`cookie.consent`). Gli analytics si caricano solo con consenso e solo se `NEXT_PUBLIC_ANALYTICS_SRC` è configurato.
- Pagine legali in MDX (`content/legal`), con `dynamicParams = false`; testi marcati "DA VALIDARE CON IL LEGALE".
- Esportazione GDPR dei dati rimandata alla Fase 11; l'eliminazione dell'account (anonimizzazione, step-up, bloccata con ordini aperti) è già attiva.

## ADR-0024 — Codice condiviso tra API e worker solo tramite `packages/*`

- **Decisione:** nessun import tra app. Il worker usa `@accordo/db`, `@accordo/domain`, `@accordo/emails` (la porta `EmailProvider` e l'adapter SMTP si sono spostati lì) e ha la propria validazione dell'ambiente.
- **Conseguenze:** la logica di dominio condivisa (es. `isSimilarImage`) sta in `packages/domain`; la piccola duplicazione del controllo "foto riutilizzate" (API alla pubblicazione, worker su una foto nuova di un annuncio attivo) è accettata.

## ADR-0025 — Bozze con prezzo 0

- Il wizard salva la bozza prima che il prezzo sia scelto. Il vincolo diventa `CHECK ("priceCents" > 0 OR "status" = 'DRAFT')` (migrazione `draft_price`); la pubblicazione e le modifiche fuori bozza richiedono un prezzo > 0 (`LISTING_INCOMPLETE`, `PRICE_REQUIRED`).

## ADR-0026 — Outbox e code

- Il dispatcher nel worker legge `OutboxEvent` ogni secondo con `FOR UPDATE SKIP LOCKED` e pubblica su BullMQ usando l'id della riga come `jobId` (nessun duplicato in caso di nuovo invio). Errori: tentativi con backoff esponenziale, `FAILED` dopo 10.
- Instradamento: `media.*` → coda `media`; `listing.price_dropped`, `listing.review_pending` → `notifications`. Dalla Fase 4 tutti i `listing.*` vanno anche a `search-index` (ADR-0030); gli eventi senza consumatore vengono marcati come elaborati.
- Ciclo di vita degli annunci: job orario (`5 * * * *`, Europe/Rome) con finestre di un'ora per i promemoria a 7 e 1 giorno; la scadenza non viene mai saltata.

## ADR-0027 — Media

- Upload diretto con POST firmato (S3 `createPresignedPost`, 15 MB, tipo di contenuto fissato) nel bucket privato `uploads/tmp/{userId}/…`; CORS dei bucket impostato all'avvio in sviluppo (POST sul privato, GET sul pubblico per la rotazione nel browser). In produzione il CORS va configurato sul provider.
- L'immagine viene creata subito con `width = 0` (= in elaborazione); il worker verifica i magic bytes, applica l'orientamento EXIF, rimuove tutti i metadati, genera le varianti e aggiorna dimensioni, LQIP e dHash. I file non validi vengono scartati.
- Ridimensionamento e rotazione avvengono nel browser (canvas → JPEG, lato lungo ≤ 2560 px). La rotazione di una foto già caricata riscarica la variante 2048, la ruota, la ricarica e sostituisce la foto nella stessa posizione.
- Controllo "foto riutilizzate" su massimo 5.000 hash della stessa categoria (scansione lineare; BK-tree quando servirà).

## ADR-0028 — Pagina annuncio

- Pagina SSR non messa in cache (dati sempre freschi); la cache con tag e la revalidazione via outbox (SPEC §5.8) arrivano con le pagine di ricerca e categoria (Fase 4).
- Visibili al pubblico: `ACTIVE`, `RESERVED`, `SOLD` (venduti `noindex` dopo 30 giorni). Il proprietario vede anche bozze e annunci in revisione, con visualizzazioni e link di modifica. URL canonico `/annuncio/{slug}-{shortId}` con redirect 308 se lo slug non coincide.
- Pulsanti "Compra", "Fai un'offerta" e "Contatta" arrivano con le fasi 5–6; preferiti con la Fase 4.
- Lighthouse (build di produzione locale, mobile simulato): annuncio con foto di test a rumore casuale Performance 86, annuncio demo 95; Accessibilità 100, SEO 100.

## ADR-0029 — Pacchetto `@accordo/search`

- Impostazioni degli indici, documento §9.1, traduzione parametri → filtri e reindicizzazione stanno in `packages/search`, usato da API, worker e script (ADR-0024).
- Il documento contiene `imageKey` (chiave dello storage) invece di `imageUrl`, come il resto dell'API; `_geo` è omesso se il comune non ha coordinate. `publishedAt` è filtrabile in più rispetto al §9.2 (serve agli avvisi delle ricerche salvate).
- Sinonimi: valore predefinito nel codice (§9.2); se esiste la chiave `PlatformSetting.searchSynonyms` vince quella (l'editor admin arriva in Fase 11; si applica con `pnpm search:reindex` o al riavvio del worker).
- Parametri di ricerca: i prezzi nell'URL sono in euro interi (`priceMin=500`), convertiti in centesimi nel filtro; gli attributi sono `attr.<chiave>=<valore>`; liste come chiavi ripetute o separate da virgole. Le ricerche salvate memorizzano la query nella stessa forma dell'URL.
- Le faccette contano con tutti i filtri applicati (non "disgiuntive"): più semplice e coerente con il totale mostrato.

## ADR-0030 — Indicizzazione via outbox

- Ogni evento `listing.*` va anche alla coda `search-index`; il job rilegge lo stato attuale dal database e fa upsert (se `ACTIVE`/`RESERVED`) o rimozione: idempotente e indipendente dall'ordine degli eventi. Concorrenza 1 per non riordinare i task di Meilisearch.
- Le modifiche alle foto (riordino, eliminazione, fine elaborazione nel worker) scrivono `listing.updated`, perché la copertina fa parte del documento.
- Il worker all'avvio crea gli indici mancanti e applica le impostazioni; ogni ora aggiorna gli indici leggeri `brands` (con il numero di annunci, usato per l'ordinamento dei suggerimenti) e `categories`.
- `pnpm search:reindex` costruisce `<indice>_next`, poi `swapIndexes` atomico e cancellazione della copia vecchia (al primo avvio, rinomina).

## ADR-0031 — Modalità degradata e limiti

- Il client Meilisearch dell'API ha timeout 1,5 s; qualunque errore → ripiego su PostgreSQL: ogni parola deve comparire nel titolo (`ILIKE`, servito dall'indice GIN `pg_trgm`) + filtri base, ordinamenti per data e prezzo, niente faccette né distanza; il web mostra un avviso. Suggerimenti: marche e categorie dal database.
- Ricerca anonima limitata a 60/min per IP (§13.2), suggerimenti a 120/min. Il web inoltra `x-forwarded-for` nelle chiamate SSR; in produzione `trust proxy` va impostato sul numero reale di proxy (Fase 12), altrimenti tutte le richieste SSR condividerebbero l'IP del server web.

## ADR-0032 — Avvisi delle ricerche salvate

- Coda `saved-search-alerts`: `INSTANT` ogni 10 minuti, `DAILY` alle 8:00 Europe/Rome. Per ogni ricerca si riesegue la query con `publishedAt > lastNotifiedAt` (o la data di creazione), escludendo gli annunci dell'utente stesso; `lastNotifiedAt` diventa la data di pubblicazione dell'annuncio più recente notificato, così non ci sono duplicati tra un giro e l'altro. Notifica in-app + email secondo la preferenza `saved_search.results`.
- **Per scalare** (molte ricerche salvate): oggi una query per ricerca (lineare). Il passo successivo è la ricerca inversa ("percolazione"): a ogni `listing.published` si valutano le ricerche salvate raggruppate per filtri strutturati (categoria, marca, regione, fascia di prezzo) in tabelle indicizzate, eseguendo il testo solo sulle candidate; in alternativa un motore con percolator nativo (OpenSearch).

## ADR-0033 — Pagine di ricerca, SEO e cache

- `/annunci` e le pagine reparto/categoria/categoria+marca/marca condividono un unico componente server; i filtri sono nell'URL, il primo blocco di risultati è SSR, su telefono le pagine successive si caricano scorrendo (su desktop paginazione con link).
- Indicizzabili solo le pagine di atterraggio senza altri filtri e con almeno 3 risultati (canonical sul percorso, `?page=N` per le pagine successive); il resto è `noindex, follow`. `/annunci` è indicizzabile solo senza parametri.
- Sitemap: indice `/sitemap.xml` + `/sitemaps/{static,categories,brands,listings-N}.xml` (10.000 URL per file) generati su richiesta con i dati dell'API in cache per un'ora: equivale al job orario del §5.7 senza un altro job. Negozi nella sitemap con la Fase 10.
- Cache: catalogo, marche e regioni usano la data cache di Next (5 minuti); i risultati di ricerca non si mettono in cache (§5.8). La pagina annuncio resta dinamica (conteggio visualizzazioni e vista del proprietario), quindi l'endpoint `/api/revalidate` con tag non serve ancora: si aggiunge in Fase 12 se le misure lo richiedono.
- Visti di recente: cronologia locale (20 annunci, anche anonimi) unita all'account alla prima apertura di "Visti di recente" nella sessione; per gli utenti autenticati ogni visita viene registrata anche sul server (50 annunci).

## ADR-0034 — Messaggi e anti-truffa

- Una conversazione per (annuncio, acquirente), creata al primo messaggio o alla prima offerta. Limiti: 30 nuove conversazioni al giorno (10 per account < 7 giorni), 30 messaggi al minuto.
- `scanMessage` all'invio: se il mascheramento si applica (l'altra parte non ha ancora scritto, o il mittente ha meno di 7 giorni) si salva **solo** il testo mascherato, mai l'originale. I flag restano sul messaggio; l'avviso al destinatario compare per `LINK`, `IBAN`, `OFF_PLATFORM_PAYMENT`, `MESSAGING_APP` (non per telefono/email da soli).
- I link nei messaggi non sono mai cliccabili (anche quelli interni: è la scelta più semplice compatibile con il §13.4).
- 5 messaggi con avviso in 24 ore verso conversazioni diverse → utente `LIMITED` + `AuditLog` `user.limited`. Un account `LIMITED` può rispondere nelle conversazioni esistenti ma non aprirne di nuove né fare offerte; la revisione dello staff arriva con il backoffice (Fase 11).
- Blocco (in un senso o nell'altro): niente messaggi né offerte, la conversazione resta leggibile. Segnalazione di un messaggio altrui → `Report` `MESSAGE` (10 al giorno).
- Immagini nei messaggi (§3.5) **rimandate**: richiedono un bucket privato con URL firmati per i soli partecipanti; non servono ai criteri della fase.
- Notifica "nuovo messaggio" (in-app + email secondo preferenze) solo quando la conversazione passa da 0 a 1 non letti: una notifica per gruppo di messaggi, non una per messaggio.

## ADR-0035 — Realtime

- Socket.IO su `/ws` nell'API con `@socket.io/redis-adapter`; il worker emette con `@socket.io/redis-emitter` sullo stesso Redis (notifiche, scadenze delle offerte).
- Autenticazione all'handshake con il cookie di sessione Better Auth; `allowRequest` rifiuta Origin diversi da `WEB_URL` (cross-site WebSocket hijacking). Ogni socket entra solo in `user:{id}`: gli eventi sono indirizzati ai due partecipanti, quindi le stanze `conversation:{id}` del §5.6 non servono (nessuna iscrizione da verificare).
- Gli eventi (`message:new`, `conversation:read`, `offer:updated`, `notification:new`) non portano dati da fidarsi: il client invalida le query e rilegge dall'API. Senza socket le schermate fanno polling (5 s nella chat, 15 s nell'elenco, 30 s nel badge).
- Le emissioni dell'API avvengono dopo il commit della transazione.
- `MessagingModule` è registrato prima di `ListingsModule`: la route generica `POST listings/:id/:action` altrimenti cattura `POST listings/:id/offers`.

## ADR-0036 — Offerte

- Nuova colonna `Offer.proposedById` (migrazione con backfill ricorsivo: acquirente per l'offerta iniziale, poi alternato) + vincolo `amountCents > 0`. Regole pure in `packages/domain/src/offers.ts`: importo tra minimo (50%) e prezzo, solo il destinatario accetta/rifiuta/controproponendo, solo il proponente ritira.
- Max 3 offerte `PENDING` per acquirente e annuncio; 20 offerte al giorno per utente.
- Accettazione: aggiornamento condizionato (`status = PENDING`) dell'offerta e dell'annuncio (`ACTIVE → RESERVED`) nella stessa transazione: due accettazioni concorrenti non possono riservare due volte. `expiresAt` dell'offerta accettata diventa la scadenza del checkout (24 h); `listing.reserved` aggiorna l'indice.
- Le altre offerte in attesa restano `PENDING` ma non sono accettabili finché l'annuncio è riservato; scadono da sole.
- Sweeper ogni minuto nel worker: offerte `PENDING` scadute → `EXPIRED`; offerte `ACCEPTED` scadute senza ordine → `EXPIRED` e annuncio `RESERVED → ACTIVE` (`listing.released`). Ogni evento lascia un messaggio `OFFER` nella conversazione e notifica le parti. Il checkout al prezzo concordato (`CONSUMED`) arriva con la Fase 6.

## ADR-0037 — Porta `PaymentProvider` e adapter finto

- `packages/payments`: porta (account connessi, onboarding, PaymentIntent, commissioni, trasferimenti con `source_transaction`, rimborsi, webhook normalizzati) con due adapter scelti da `PAYMENT_PROVIDER`.
- **Scelta dell'utente (Fase 6): `fake`.** Nessuna rete; gli id derivano dalle chiavi di idempotenza (un retry restituisce lo stesso oggetto); gli eventi passano dal **vero** endpoint webhook, firmati HMAC (`x-fake-signature`). Endpoint di sviluppo (404 in produzione): `POST /dev/orders/:id/payment` (riuscito/rifiutato), `POST /dev/payments/onboarding-complete`, `POST /dev/orders/:id/run-timer`. Il checkout mostra "Paga (simulazione)".
- Adapter `stripe`: Accounts v2 (`dashboard: express`, `losses_collector`/`fees_collector = application`, `recipient` con `stripe_balance.stripe_transfers`, `identity.country = it`), Account Link di onboarding, PaymentIntent con `transfer_group` e `automatic_payment_methods`, trasferimenti e rimborsi con chiavi idempotenti, verifica della firma con `constructEvent`. **Non ancora provato con un account test**: restano da verificare con le chiavi il criterio "trasferimento visibile nella Dashboard", la mappatura degli eventi degli account v2 (oggi gestito `account.updated`) e il Payment Element con 3DS (`4000 0027 6000 3184`).
- Stripe.js si carica solo quando il provider è `stripe`.

## ADR-0038 — Motore degli ordini condiviso

- La regola d'oro "lo stato cambia solo tramite `OrdersService.transition()`" è implementata da `applyOrderEvent` in `packages/orders`, perché la usano sia l'API (azioni, webhook) sia il worker (sweeper, webhook): macchina a stati del dominio, lock ottimistico su `version` (`ORDER_CHANGED` 409), `OrderEvent`, timer `nextAction`.
- Effetti sincroni nella stessa transazione: ledger del pagamento (`payment:{orderId}`), offerta `CONSUMED`, stato dell'annuncio (+ eventi `listing.*` per l'indice), hash del codice di consegna, conteggio delle cancellazioni del venditore. Effetti esterni in una riga outbox `order.effects` → coda `payments` del worker (trasferimento, rimborso, annullamento del PaymentIntent, notifiche).
- La creazione dell'ordine (`CHECKOUT_STARTED`) è nel checkout dell'API: guardie del dominio, importi da `computeOrderAmounts` con le impostazioni correnti "fotografate" sull'ordine, indice unico parziale per un solo ordine attivo per annuncio (due acquisti concorrenti → un 201 e un 409 `LISTING_NOT_AVAILABLE`), `Idempotency-Key` obbligatoria (tabella `IdempotencyKey`, 24 h; stesso corpo → stessa risposta, altro corpo → 422).
- **Spedizione integrata non offerta al checkout fino alla Fase 7** (servono provider ed etichetta); `CREATE_SHIPPING_LABEL`, `REGISTER_TRACKING`, `CREATE_RETURN_LABEL` sono no-op fino ad allora. `OPEN_FEEDBACK` è implicito (Fase 9: feedback possibile sugli ordini `COMPLETED`).
- Annullamento concordato: la richiesta è un `OrderEvent` `CANCEL_REQUESTED` senza cambio di stato; l'accettazione dell'altra parte applica `MUTUAL_CANCEL`. L'annullamento unilaterale del venditore vale solo per ordini `PAID` (come da §6.4).
- Pagamento di un'offerta accettata: link "Paga ora" dalla chat alla pagina annuncio con `?offerta=` (il prezzo è quello concordato, l'annuncio riservato è acquistabile solo da quell'acquirente).

## ADR-0039 — Codice di consegna a mano

- Il codice è `HMAC(HANDOVER_CODE_PEPPER, "code:" + orderId)` ridotto a 6 cifre: l'acquirente può rivederlo dopo lo step-up, ma nel database c'è solo il suo hash (`HMAC(pepper, orderId:code)`, confronto a tempo costante, 5 tentativi poi 1 ora di blocco). Chi legge il database non può ricavarlo senza il segreto.
- Gli ordini demo già presenti nel database locale usano ancora il codice fisso `123456` del seed.

## ADR-0040 — Webhook, rimborsi, riconciliazione

- `POST /api/v1/webhooks/stripe`: corpo grezzo (`express.raw` montato prima del parser JSON), firma verificata, `WebhookEvent` (`provider` + `eventId`) e riga outbox `webhook.received` nella stessa transazione, 200 subito; un duplicato risponde 200 senza nuova elaborazione. Il worker elabora con retry esponenziale e scrive `ALERT` nei log dopo 5 fallimenti (il pannello "Log webhook" arriva col backoffice, Fase 11).
- Pagamento riuscito su un ordine già scaduto → rimborso automatico (`late-refund:{orderId}`).
- Rimborsi con chiave `refund:{orderId}:{eventId}` (l'evento di transizione che li ha generati): stabile tra i retry. Rimborso totale prima del trasferimento → storno simmetrico del pagamento; parziale → riduce `SELLER_PAYABLE`. Trasferimento sospeso (`ON_HOLD`) se l'account del venditore non è abilitato o c'è un chargeback; ripartono quando arriva `account.updated` con trasferimenti attivi.
- Chargeback (`dispute.created`): `PaymentDispute` e trasferimento in `ON_HOLD`; prove e invio a Stripe con la Fase 8.
- Controllo notturno (03:30): transazioni sbilanciate, ordini chiusi con saldo `SELLER_PAYABLE` ≠ 0, fondi trattenuti oltre 60 e 85 giorni (`funds-hold-guard`); in caso di anomalie notifica agli admin. Il confronto con le _balance transaction_ di Stripe si aggiunge qui quando l'adapter reale sarà attivo.

## ADR-0041 — Spedizioni: porte, mock e Sendcloud

- `packages/shipping` contiene le porte del §7.2 (`ShippingProvider`, `TrackingProvider`) e due adapter scelti da `SHIPPING_PROVIDER`: `mock` (predefinito) e `sendcloud`. Le porte stanno in un pacchetto e non in `apps/api/…/ports.ts` perché le usano anche il worker (etichette) e i test (ADR-0024).
- **Provider scelto dall'utente: Sendcloud. Credenziali sandbox non disponibili**: la fase è completata con `mock`; `sendcloud` è dietro feature flag (richiede `SHIPPING_API_KEY`/`SHIPPING_API_SECRET` = chiavi pubblica e segreta dell'integrazione) ed è coperto da **test di contratto** su payload d'esempio (creazione parcel con metodo più economico compatibile con peso e punto di ritiro, download dell'etichetta, annullamento 200/410, punti di ritiro, firma `Sendcloud-Signature` = HMAC-SHA256 del corpo con la chiave segreta, mappatura degli id di stato). Da verificare con un account reale: id e pesi dei metodi, campi `from_*` del mittente, eventi di reso.
- Tracking della spedizione autonoma: esiste solo il `TrackingProvider` mock (nessun servizio di tracking multi-corriere nell'MVP). Senza evento di consegna l'ordine si chiude dopo 10 giorni (§6.5).
- Webhook `POST /webhooks/shipping/:provider` e `/webhooks/tracking/:provider`: firma HMAC sul corpo grezzo, `WebhookEvent` con id = SHA-256 del corpo (duplicati ignorati), outbox `shipping.updates` → coda `shipping` del worker. Prima presa in carico (`IN_TRANSIT`, `OUT_FOR_DELIVERY`, `AVAILABLE_FOR_PICKUP` o `DELIVERED`) → `SHIPMENT_CONFIRMED`; `DELIVERED` → `DELIVERED` (+72 h di verifica); eccezioni e resi al mittente notificati; eccezioni oltre 5 giorni nel controllo notturno (ticket di supporto con il backoffice, Fase 11). Reso consegnato al venditore → timer `RETURN_INSPECTION_DEADLINE` (+48 h).
- Etichette nel bucket privato (`labels/{orderId}/{shipmentId}.pdf`), scaricate da `GET /orders/:id/label` dopo il controllo della parte (venditore per l'andata, acquirente per il reso), in streaming con `Cache-Control: private, no-store`, invece di un URL firmato: stesso risultato, nessun link riutilizzabile fuori dalla sessione.
- Checkout con spedizione integrata: serve la taglia del pacco e l'indirizzo `SENDER` del venditore; prezzo all'acquirente = prezzo configurato della taglia (`parcelSizes`), "fotografato" sull'ordine. Punto di ritiro: `servicePointId` + `servicePointCap` (il CAP con cui l'elenco è stato chiesto), verificato contro il provider e salvato su `Order.servicePoint`.
- Il costo reale delle etichette (fattura del provider) non passa da Stripe: `SHIPPING_PAYABLE` resta il debito verso il provider, riconciliato con le fatture. `quote()` è implementato ma il prezzo mostrato resta quello configurato (§7.1).
- Ordine annullato prima della spedizione: l'etichetta inutilizzata viene annullata; se il provider rifiuta e la colpa è del venditore (`SELLER_CANCELLED`, `SHIP_DEADLINE_EXPIRED`) il costo gli viene addebitato (`SELLER_RECEIVABLE` ↔ `SHIPPING_PAYABLE`, riferimento `label-charge:{orderId}`); altrimenti resta alla piattaforma.
- Correzione della Fase 6 trovata qui: il checkout non mostrava mai il Payment Element con `PAYMENT_PROVIDER=stripe` (usava una variabile rimasta `null`).

## ADR-0042 — Controversie

- Procedura del §6.6 come funzione pura `disputeStep` (`packages/domain/src/disputes.ts`): risposta del venditore (rimborso con reso, rimborso, proposta parziale ≤ prezzo dell'oggetto, rifiuto → supporto), accettazione dell'acquirente, escalation, ritiro (pagamento al venditore), scadenze automatiche, decisione dello staff, ricorso. `applyDisputeAction` (`packages/orders`) la applica nella stessa transazione: riga della controversia (aggiornamento condizionato sullo stato), messaggio, evento dell'ordine tramite `applyOrderEvent` (il denaro si muove solo lì), timer dell'ordine, contatore `disputesLost12m`, notifiche.
- Un solo timer per ordine (`nextAction`): `DISPUTE_SELLER_DEADLINE` (72 h, impostato all'apertura) e `DISPUTE_BUYER_DEADLINE` (72 h dopo una proposta) portano la controversia al supporto. `runDueAction` è condiviso tra lo sweeper e l'endpoint di sviluppo `POST /dev/orders/:id/run-timer` (che ora esegue subito il passo, usato da J8). La scadenza di 5 giorni lavorativi per la decisione dello staff e i 48 h per le prove richieste sono comunicati nei testi, senza timer automatici.
- Dopo il reso consegnato il venditore ha 48 h (`RETURN_INSPECTION_DEADLINE`) per contestarlo (escalation); lo staff può allora solo rimborsare (`RETURN_ACCEPTED`) o pagare il venditore (`RETURN_NOT_SHIPPED`), i soli eventi ammessi dalla macchina a stati in `RETURN_IN_TRANSIT`. Quando l'ordine si chiude (completato o rimborsato) la controversia aperta si chiude con lui.
- Prove: foto caricate con lo stesso POST firmato degli annunci, poi copiate dall'area temporanea dell'utente in `disputes/{id}/…` del bucket privato e servite solo alle parti e allo staff (`GET /disputes/:id/evidence/:id`, `no-store`).
- Responsabilità del venditore (`Dispute.sellerAtFault`): la decide lo staff; accettare un rimborso vale come ammissione. Solo una decisione dello staff con responsabilità conta come controversia persa (accettare spontaneamente non penalizza, per incoraggiare l'accordo).
- Ricorso: uno per parte entro 7 giorni dalla decisione, esaminato da un membro dello staff diverso (`SAME_REVIEWER`); l'esito (confermata/riformata, motivazione) è registrato. Se la decisione è riformata, l'eventuale rimborso aggiuntivo si fa con `POST /admin/orders/:id/refund` (rimborso manuale su ordine completato, registrato in `AuditLog`): il denaro già mosso non si annulla automaticamente.
- Politica §6.7 configurabile in `PlatformSetting.refundPolicy`: etichetta addebitata al venditore se l'annullamento è colpa sua (predefinito sì) o concordato (predefinito no), etichetta di reso addebitata al venditore responsabile (predefinito sì).

## ADR-0043 — Rimborsi dopo il trasferimento, crediti verso i venditori, chargeback

- Rimborso dopo il trasferimento (solo fino a quanto ricevuto dal venditore): `REFUND_AFTER_TRANSFER` (credito `SELLER_RECEIVABLE`), poi storno del trasferimento (`reverseTransfer` nella porta) con `TRANSFER_REVERSAL` che salda il credito. Se lo storno fallisce il credito resta e viene **compensato** sul trasferimento successivo dello stesso venditore (`transferWithOffsetEntries`: trasferisce la differenza, nessuna chiamata al provider se il credito copre tutto). Equivale al "blocco finché il credito non è saldato" del §6.7 senza fermare i pagamenti.
- Chargeback (`dispute.created`): `PaymentDispute`, trasferimento `ON_HOLD` se non ancora partito, prove raccolte e inviate subito (`submitDisputeEvidence`: eventi dell'ordine, spedizione e tracking, verifica del codice di consegna, estratto della chat). Esito (`dispute.closed`): vinto → si paga il venditore; perso con **protezione venditore** (spedizione tracciata consegnata o codice di consegna verificato) → perdita della piattaforma (`CHARGEBACK_LOSSES`) e il venditore viene pagato; perso senza protezione → prima del trasferimento si annulla il debito verso il venditore (`payoutStatus = REVERSED`), dopo il trasferimento diventa un suo credito (con storno tentato). Un chargeback aperto blocca il trasferimento; uno chiuso no.
- Con l'adapter finto il chargeback si simula con `POST /dev/orders/:id/chargeback` e `POST /dev/payment-disputes/:id/close`; con Stripe test la carta `4000 0000 0000 0259` genera `charge.dispute.created` (da verificare con le chiavi, insieme a `charge.dispute.closed` e all'invio delle prove).
