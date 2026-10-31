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

## Fase 2 — Autenticazione, profili e impostazioni

**Piano**
1. API `auth`: Better Auth 1.7 montato su `/api/auth/*` (handler Node su Express, ADR), adapter Prisma, email+password (min 10), verifica email obbligatoria, reset password, Google (se configurato), plugin admin/username/twoFactor/passkey, captcha Turnstile (chiavi di test), rate limit su Valkey, id generati da Prisma.
2. Guard globali: sessione, email verificata, ruoli (staff con 2FA obbligatoria), impersonificazione in sola lettura, controllo `Origin`; step-up (`STEP_UP_REQUIRED`) con dispositivi riconosciuti (cookie firmato + `KnownDevice`) e codice email per dispositivi nuovi; avviso email di nuovo accesso.
3. Email: porta `EmailProvider` (SMTP → Mailpit), template React Email in `packages/emails` (verifica, reset, nuovo dispositivo, codice step-up, password cambiata).
4. API `users`/`geo`: `GET/PATCH /me`, indirizzi (anti-IDOR), profilo pubblico, segui/blocca, preferenze notifiche, eliminazione account (step-up), autocompletamento comuni, registro consensi cookie.
5. Web: client Better Auth, pagine `/accedi` (password, passkey, 2FA), `/registrati`, `/verifica-email`, `/password-dimenticata`, `/reimposta-password`, `/account`, impostazioni (profilo, indirizzi, sicurezza: password/2FA/passkey/sessioni, notifiche, privacy), profilo pubblico `/utente/[username]`, banner cookie (Garante), pagine legali MDX segnaposto.
6. Test: integrazione API (Testcontainers) per `STEP_UP_REQUIRED` e anti-IDOR; e2e Playwright registrazione → verifica email (Mailpit) → login → 2FA → login con TOTP; test "nessun analytics prima del consenso".

**Fatto**
- API: Better Auth 1.7 su `/api/auth/*` (email+password, verifica email obbligatoria, reset, Google opzionale, 2FA TOTP con codici di backup, passkey, ruoli, Turnstile, limiti su Valkey); guard globale (sessione, email verificata, Origin, ruoli + 2FA staff, impersonificazione in sola lettura); dispositivi riconosciuti, avviso di nuovo accesso, step-up con password e/o codice email; `/me`, indirizzi, profilo pubblico e annunci, segui/blocca, preferenze notifiche, eliminazione account; autocompletamento comuni; registro consensi.
- Email: 5 template React Email in italiano, invio SMTP (Mailpit).
- Web: pagine `/accedi` (password, passkey, Google, 2FA/backup), `/registrati`, `/verifica-email`, `/password-dimenticata`, `/reimposta-password`, `/account` con impostazioni (profilo con comune, indirizzi, sicurezza: password, 2FA con QR, passkey, dispositivi; notifiche; privacy), `/utente/[username]` SSR, banner cookie, pagine legali MDX, 404. Proxy con redirect dell'area privata.
- Test: integrazione API (Testcontainers PostgreSQL + Valkey) per `STEP_UP_REQUIRED` (dispositivo nuovo e autenticazione vecchia, anche su `/change-password`), anti-IDOR sugli indirizzi, Origin, termini obbligatori, utenti non verificati; e2e Playwright: registrazione → verifica email da Mailpit → accesso → attivazione 2FA → nuovo accesso con TOTP; redirect dell'area privata; nessuno script di analytics prima del consenso.
- Credenziali demo: tutti gli utenti demo hanno la password `accordo-demo-2026`.
- Decisioni: ADR-0018…0023.

**Rimandato**
- Esportazione GDPR (Fase 11), revoca automatica dal link "Non sono stato io" e limite di login per account (Fase 12), e2e in CI (Fase 12), notifiche push (dopo l'MVP).

## Fase 3 — Catalogo, annunci e media

**Piano**
1. Catalogo: `GET /catalog/departments`, attributi per categoria, marche con alias, suggerimento categoria dal titolo (dominio); schema Zod degli attributi costruito a runtime (§10.3).
2. Annunci: bozza → wizard "Vendi" (5 passi, salvataggio automatico), modifica, pubblicazione con controlli automatici (§13.5: parole vietate, prezzo anomalo, foto riutilizzate, venditore nuovo sopra 2.000 €, limite giornaliero), pausa/ripresa/rinnovo/rialzo/venduto/eliminazione, storico prezzi, annunci simili, "I miei annunci".
3. Media (§5.9): ridimensionamento lato client, POST firmato S3, collegamento all'annuncio, elaborazione nel worker (magic bytes, orientamento, rimozione metadati, WebP 320/640/1280/2048 + JPEG 1280, LQIP, dHash), riordino ed eliminazione.
4. Outbox: eventi scritti nella stessa transazione, dispatcher nel worker verso BullMQ (`media`, `notifications`).
5. Worker: elaborazione media, notifiche in-app ed email secondo le preferenze, job orario del ciclo di vita (promemoria a 7 e 1 giorno, scadenza).
6. Web: wizard `/vendi`, pagina annuncio SSR con galleria accessibile e JSON-LD, `/account/annunci`, notifiche.
7. Test: nessun EXIF/GPS nelle varianti, prezzo anomalo → revisione, anti-IDOR, e2e annuncio con 5 foto; Lighthouse sulla build di produzione.

**Fatto**
- Catalogo: albero reparti/categorie (cache Valkey), attributi per categoria, marche con alias, suggerimento categoria dal titolo (`suggestCategories` nel dominio); schema Zod degli attributi costruito a runtime (`buildAttributesSchema`).
- Annunci: creazione bozza (limiti 20/giorno, 5 per account < 7 giorni), modifica con controlli sulle modifiche sostanziali, pubblicazione con verifica di completezza e controlli automatici (parole vietate, prezzo anomalo, foto riutilizzate, venditore nuovo sopra 2.000 €), pausa/ripresa/rinnovo/rialzo/venduto/eliminazione, storico prezzi e ribassi via outbox, annunci simili, "I miei annunci".
- Media: upload firmato, elaborazione nel worker (varianti WebP 320/640/1280/2048 + JPEG 1280, LQIP, dHash, nessun metadato), riordino, rotazione, eliminazione.
- Worker: dispatcher dell'outbox, code `media` e `notifications`, notifiche in-app ed email secondo le preferenze, job orario del ciclo di vita.
- Web: wizard `/vendi` in 5 passi con salvataggio automatico, pagina annuncio SSR con galleria accessibile (tastiera, swipe, zoom), JSON-LD `Product`/`Offer`/`BreadcrumbList`, etichette privato/negozio e dati legali del negozio, `/account/annunci` con azioni, modifica, notifiche con campanella.
- Test: pipeline media (nessun EXIF/GPS/XMP/IPTC nelle varianti, orientamento applicato, magic bytes); integrazione API (bozze private, anti-IDOR, completezza, attributi, prezzo anomalo, parole vietate, foto riutilizzate, ribasso, ciclo di vita); integrazione worker (dispatcher, ciclo di vita, preferenze email); e2e annuncio con 5 foto visibile sulla sua pagina.
- Lighthouse sulla build di produzione: vedi ADR-0028 (tutti i criteri raggiunti).
- Decisioni: ADR-0024…0028.

## Fase 4 — Ricerca, navigazione e SEO

**Piano**
1. `packages/search`: client Meilisearch, impostazioni §9.2 (sinonimi da `PlatformSetting.searchSynonyms`), documento §9.1 costruito da Prisma, traduzione parametri → filtri/ordinamenti (condivisa da API e worker), reindicizzazione con indice nuovo + `swapIndexes`, indici leggeri `brands` e `categories`.
2. Worker: coda `search-index` alimentata da tutti gli eventi `listing.*` (upsert se `ACTIVE`/`RESERVED`, altrimenti rimozione); coda `saved-search-alerts` (istantanei ogni 10 minuti, riepilogo alle 8:00 Europe/Rome).
3. API: `GET /search/listings` (faccette, distanza, ordinamenti, attributi per categoria, limite anonimi 60/min), `GET /search/suggest`, modalità degradata su PostgreSQL (`pg_trgm`), ricerche salvate, preferiti, visti di recente, feed dei seguiti, dati per le sitemap.
4. Web: barra di ricerca con autocompletamento, `/annunci` con filtri nell'URL, pagine reparto/categoria/marca con canonical e regole `noindex`, preferiti, visti di recente (anche anonimi), ricerche salvate, feed dei seguiti, home con annunci recenti, `sitemap.xml` + `robots.txt`.
5. Script: `pnpm search:reindex`, `pnpm db:seed:big` (100.000 annunci), benchmark p95.
6. Test: refusi, faccette = database, raggio 30 km da Milano, modalità degradata, avvisi delle ricerche salvate.

**Fatto**
- `packages/search`: impostazioni §9.2 (tolleranza ai refusi, stop word italiane, sinonimi di settore, `bumpedAt:desc` in coda), documento §9.1, traduzione dei parametri (faccette, attributi per categoria, `_geoRadius`/`_geoPoint`, ordinamenti), indici leggeri `brands`/`categories`, reindicizzazione con indice `_next` e `swapIndexes`.
- Worker: coda `search-index` su tutti gli eventi `listing.*` (anche cambi di foto), aggiornamento orario degli indici leggeri, avvisi delle ricerche salvate (istantanei ogni 10 minuti, riepilogo alle 8:00) con notifica in-app ed email.
- API: `GET /search/listings` (limite anonimi 60/min per IP), `GET /search/suggest`, modalità degradata su PostgreSQL, ricerche salvate (max 50, anti-IDOR), preferiti con contatore esatto, visti di recente (con unione della cronologia locale), utenti seguiti e loro feed, dati delle sitemap, `GET /catalog/brands/all`, `GET /geo/comuni/:id`.
- Web: barra di ricerca con autocompletamento (combobox ARIA) nell'header e in home; `/annunci` con filtri nell'URL (reparto, categoria, marca, prezzo, anno, condizioni, regione, comune + raggio, venditore, opzioni, attributi della categoria), ordinamenti, salva ricerca, scroll infinito su telefono; pagine `/categoria/[reparto]`, `/categoria/[reparto]/[categoria]`, `/categoria/[reparto]/[categoria]/[marca]`, `/marca/[marca]` con canonical e `noindex` secondo §9.3; card con badge, venditore e distanza; preferiti (cuore su card e annuncio); `/account/preferiti`, `/account/ricerche-salvate`, `/account/visti-di-recente`, `/account/seguiti`; home con reparti, ultimi annunci, visti di recente (anche anonimi), JSON-LD `WebSite`/`SearchAction`/`Organization`; `sitemap.xml` (indice + file paginati) e `robots.txt`.
- Script: `pnpm search:reindex`, `pnpm db:seed:big` (100.000 annunci in ~36 s), `pnpm search:bench`.
- Criteri: "stratocster" trova "Stratocaster" (integrazione + e2e "fendr"); faccette = conteggi del database (integrazione); raggio 30 km da Milano include Monza ed esclude Bergamo, ordinato per distanza (integrazione); **p95 14,9 ms** (p50 9,1 ms) su 500 richieste API con 96.505 annunci indicizzati; email della ricerca salvata arrivata in Mailpit (flusso reale outbox → indice → avviso) e test di integrazione del worker; con il container Meilisearch fermo la ricerca risponde in modalità degradata e il web mostra l'avviso (integrazione + verifica manuale).
- Test: 7 unitari (`packages/search`), 13 di integrazione API (ricerca, ricerche salvate, preferiti, visti, seguiti, sitemap, degradata), 1 di integrazione worker (avvisi), e2e ricerca (5 e2e in totale).
- Decisioni: ADR-0029…0033.

**Rimandato**
- Endpoint `/api/revalidate` e pagine con tag di cache (Fase 12, ADR-0033); barra inferiore mobile (Fase 12); negozi nella sitemap (Fase 10); editor admin dei sinonimi (Fase 11); `trust proxy` di produzione (Fase 12).

## Fase 5 — Messaggistica, offerte e notifiche

**Piano**
1. Dominio: regole delle offerte (importo minimo, chi può rispondere, transizioni) come funzioni pure; `scanMessage` già pronto (Fase 1).
2. API `messaging`: conversazioni (una per annuncio e acquirente, limiti §13.2, blocchi), messaggi con `scanMessage` (mascheramento per account nuovi, flag e avvisi, utente `LIMITED` dopo 5 conversazioni segnalate in 24 h), letto/archiviato, segnalazione di un messaggio.
3. Realtime: gateway Socket.IO su `/ws` con adapter Redis, autenticazione col cookie di sessione, stanze `user:{id}`; eventi `message:new`, `conversation:read`, `offer:updated`, `notification:new` (anche dal worker via emitter Redis).
4. API `offers`: proposta (annunci trattabili con pagamento protetto, minimo 50%, max 3 attive, 48 h), accetta/rifiuta/controproposta/ritira, messaggi di sistema nella conversazione; offerta accettata → annuncio `RESERVED` per 24 h.
5. Worker: scadenza delle offerte e rilascio delle riserve ogni minuto; notifiche di messaggi e offerte secondo le preferenze.
6. Web: "Contatta" e "Fai un'offerta" sulla pagina annuncio, `/messaggi` e `/messaggi/[id]` in tempo reale (polling di riserva), banner di sicurezza, offerte nella chat, blocco e segnalazione, campanella in tempo reale.
7. Test: integrazione (mascheramento, flag, IDOR, blocchi, offerte e riserva, scadenze, preferenze email, socket), e2e J6.

**Fatto**
- Dominio: regole delle offerte (`minOfferCents`, `offerAmountError`, `offerActionError`, `counterProposer`), copertura 99,6%.
- Database: `Offer.proposedById` con backfill e vincolo sull'importo (migrazione `offer_proposer`).
- API `messaging`: conversazioni (una per annuncio e acquirente, limiti, blocchi, archivio, letti), messaggi con `scanMessage` (mascheramento per account nuovi, flag, avviso al destinatario, `LIMITED` dopo 5 conversazioni con avviso in 24 h), segnalazione di un messaggio, offerte con controproposta, ritiro, rifiuto e accettazione che riserva l'annuncio per 24 h, `GET /me/offers`.
- Realtime: Socket.IO `/ws` con adapter Redis e controllo dell'Origin; eventi `message:new`, `conversation:read`, `offer:updated`, `notification:new` (anche dal worker).
- Worker: notifiche di messaggi (una per gruppo di non letti) e offerte secondo le preferenze; sweeper delle offerte ogni minuto con rilascio delle riserve.
- Web: "Contatta il venditore" e "Fai un'offerta" sulla pagina annuncio; `/messaggi` (in arrivo e archiviate) e `/messaggi/[id]` con aggiornamento in tempo reale e polling di riserva, banner di sicurezza, avvisi sui messaggi sospetti, nota sul mascheramento, pannello offerte (accetta, rifiuta, controproponi, ritira), blocco, archivio e segnalazione; icona Messaggi con badge nell'header; campanella in tempo reale.
- Criteri: e2e J6 (due browser, IBAN con avviso in meno di 3 s, quindi via socket e non via polling); un telefono da un account nuovo è mascherato e resta mascherato finché il mittente non ha 7 giorni (integrazione); un'offerta accettata porta l'annuncio a `RESERVED` con scadenza a 24 h e blocca altre accettazioni (integrazione), lo sweeper la rilascia (integrazione worker); le email rispettano le preferenze (integrazione worker + email reali in Mailpit).
- Test: 4 unitari del dominio, 7 di integrazione API (conversazioni, mascheramento, IBAN e `LIMITED`, blocchi e segnalazioni, socket, offerte), 2 di integrazione worker, e2e J6 (6 e2e in totale).
- Decisioni: ADR-0034…0036.

**Rimandato**
- Immagini nei messaggi (ADR-0034), revisione staff degli account `LIMITED` e delle segnalazioni (Fase 11), checkout dell'offerta accettata (Fase 6), notifiche push (dopo l'MVP).

## Fase 6 — Pagamento protetto e ordini

Scelta dell'utente: **adapter di pagamento finto** (niente chiavi Stripe per ora). L'adapter Stripe reale esiste dietro la stessa porta; i criteri che richiedono la Dashboard Stripe restano da verificare quando ci saranno le chiavi test.

**Piano**
1. `packages/payments`: porta `PaymentProvider` (account connessi, PaymentIntent, trasferimenti con `source_transaction`, rimborsi, webhook normalizzati), adapter `fake` (webhook firmati HMAC, endpoint di sviluppo per simulare pagamento/onboarding) e adapter `stripe` (Accounts v2).
2. `packages/orders`: motore che applica la macchina a stati del dominio con lock ottimistico (`version`), `OrderEvent`, effetti sincroni (annuncio, ledger del pagamento, codice di consegna) e outbox per quelli esterni; usato da API (azioni, webhook) e worker (sweeper).
3. API: `POST /orders` con `Idempotency-Key`, dettaglio e timeline, spedizione autonoma con tracking, conferma ricezione con step-up, codice di consegna (step-up) e verifica, annullamento e annullamento concordato, onboarding e stato account, saldo dal ledger, webhook con verifica firma sul corpo grezzo e `WebhookEvent`, vista ordini admin.
4. Worker: coda `payments` (elaborazione webhook, trasferimenti, rimborsi, annullamento PaymentIntent con chiavi idempotenti), sweeper degli ordini ogni minuto, riconciliazione notturna (invarianti del ledger), `funds-hold-guard`.
5. Web: "Compra" con scelta della consegna, `/checkout/[orderId]` (Payment Element con Stripe, pagamento simulato con l'adapter finto), `/account/acquisti`, `/account/vendite` con timeline e azioni, `/account/incassi`, admin ordini.
6. Test: integrazione (acquisti concorrenti → 409, `Idempotency-Key`, firma e duplicati dei webhook, trasferimento con `source_transaction`, rimborsi, invarianti del ledger), e2e J3 (consegna a mano) e spedizione autonoma completa.

**Fatto**
- `packages/payments`: porta `PaymentProvider`, adapter `fake` (webhook firmati HMAC, id idempotenti) e `stripe` (Accounts v2, separate charges and transfers).
- `packages/orders`: `applyOrderEvent` (macchina a stati, lock ottimistico, `OrderEvent`, effetti sincroni, outbox `order.effects`), ledger con riferimenti univoci.
- Dominio: `deriveHandoverCode`.
- API: `POST /orders` con `Idempotency-Key` (importi §6.3, un solo ordine attivo per annuncio, limite account nuovi, prezzo dell'offerta accettata), dettaglio con timeline e azioni disponibili, elenco acquisti/vendite, spedizione autonoma con tracking validato, conferma di ricezione con step-up, codice di consegna (step-up) e verifica con blocco, annullamento del venditore e annullamento concordato, onboarding e stato dell'account pagamenti, saldo dal ledger, webhook con firma sul corpo grezzo e `WebhookEvent`, vista ordini admin, endpoint di sviluppo per l'adapter finto.
- Worker: coda `payments` (webhook: pagamento riuscito/rifiutato, aggiornamento account, chargeback; trasferimenti con `source_transaction`, rimborsi totali e parziali, annullamento PaymentIntent, notifiche degli ordini), sweeper degli ordini ogni minuto, controlli notturni (invarianti del ledger, fondi trattenuti oltre 60/85 giorni).
- Web: box "Compra con pagamento protetto" (consegna, indirizzo), `/checkout/[orderId]` (Payment Element con Stripe, pagamento simulato con l'adapter finto), `/account/acquisti` e `/account/vendite` con dettaglio, cronologia, importi, azioni (spedisci, conferma ricezione, codice con QR, verifica codice, annullamenti), `/account/incassi` (attivazione e saldo), `/admin/ordini`, "Paga ora" dalla chat per le offerte accettate, interruttore "Pagamento protetto" nel wizard abilitato dall'account pagamenti.
- Criteri (con adapter finto, scelta dell'utente): e2e J3 consegna a mano con codice (anche codice errato) e percorso completo con spedizione autonoma fino al trasferimento; due acquisti concorrenti → un 201 e un 409; `Idempotency-Key` ripetuta → stessa risposta; webhook duplicato memorizzato ed elaborato una volta; trasferimento con `source_transaction` e chiave idempotente; rimborso totale; invarianti del ledger verdi (test e database di sviluppo dopo gli e2e).
- Test: 7 integrazione API ordini/webhook, 3 integrazione worker pagamenti, 2 unitari adapter finto, 1 unitario codice di consegna, 2 e2e (8 e2e in totale).
- Decisioni: ADR-0037…0040; regole Radar in `docs/SECURITY.md`.

**Da verificare con le chiavi Stripe test**
- Trasferimento visibile sull'account connesso nella Dashboard; Payment Element con carte `4242…`, `4000 0027 6000 3184` (3DS), `4000 0000 0000 0002`; e2e J3 con `stripe listen`; eventi degli account v2.

**Rimandato**
- Spedizione integrata al checkout (Fase 7), controversie e prove dei chargeback (Fase 8), feedback (Fase 9), pannello log webhook e riconciliazione con le balance transaction (Fase 11 / chiavi Stripe), blocco anti-collusione (Fase 12).

## Fase 7 — Spedizioni

Provider scelto dall'utente: **Sendcloud**. Credenziali sandbox non disponibili: fase completata con l'adapter `mock`; l'adapter Sendcloud reale è attivabile con `SHIPPING_PROVIDER=sendcloud` (feature flag) ed è coperto da test di contratto su payload d'esempio.

**Piano**
1. `packages/shipping`: porte `ShippingProvider` e `TrackingProvider` (§7.2), adapter `mock` (PDF segnaposto, tracking `MOCK-…`, punti di ritiro finti, webhook firmati HMAC) e adapter `sendcloud` (parcels API v2, punti di ritiro, firma `Sendcloud-Signature`, mappatura degli stati).
2. Checkout: spedizione integrata (taglia del pacco, prezzi da `parcelSizes`, indirizzo mittente del venditore obbligatorio), punto di ritiro opzionale.
3. Worker (coda `shipping`): etichetta all'ordine pagato salvata nel bucket privato, annullamento dell'etichetta quando l'ordine è annullato (addebito al venditore se non annullabile e la colpa è sua), etichetta di reso, registrazione del tracking per la spedizione autonoma.
4. Webhook `POST /webhooks/shipping/:provider` e `/webhooks/tracking/:provider` con verifica HMAC → `Shipment.status`/`events`; prima presa in carico → `SHIPMENT_CONFIRMED`, consegna → `DELIVERED`, eccezioni notificate e segnalate dopo 5 giorni.
5. API: download dell'etichetta con URL firmato, punti di ritiro, `POST /dev/shipments/:id/advance` (solo sviluppo).
6. Web: scelta spedizione integrata e punto di ritiro al checkout, etichetta e tracking nelle pagine ordine, guida "Come imballare uno strumento".
7. Test: verifica HMAC (mock e Sendcloud), contratto Sendcloud, e2e J2 completo con l'adapter finto.

**Fatto**
- `packages/shipping`: porte §7.2, adapter `mock` (PDF segnaposto valido, tracking `MOCK-…`, 3 punti di ritiro per CAP, webhook HMAC) e adapter `sendcloud` dietro feature flag con test di contratto.
- API: checkout con spedizione integrata (taglia, prezzo da `parcelSizes`, indirizzo mittente obbligatorio) e punto di ritiro verificato; `GET /shipping/service-points`; etichetta PDF dal bucket privato (`GET /orders/:id/label`); webhook di spedizione e tracking con verifica HMAC; registrazione del tracking della spedizione autonoma; `POST /dev/shipments/:id/advance`; prezzo della spedizione integrata nel dettaglio annuncio.
- Worker: etichetta all'ordine pagato (coda `payments`, idempotente) con notifica "Etichetta pronta"; coda `shipping` per gli aggiornamenti di tracking (stato, eventi, `SHIPMENT_CONFIRMED`, `DELIVERED`, eccezioni, reso al mittente); annullamento dell'etichetta con addebito al venditore se dovuto; etichetta di reso; eccezioni oltre 5 giorni nel controllo notturno.
- Web: spedizione integrata e punto di ritiro nel box "Compra", etichetta, tracking ed eventi nella pagina ordine, pulsante di simulazione in sviluppo, guida `/guide/imballaggio` (anche nella sitemap e nelle notifiche).
- Criteri: e2e J2 completo con l'adapter finto (pagamento → etichetta PDF scaricabile solo dal venditore → presa in carico → in consegna → consegnato → conferma con step-up → trasferimento); test della verifica HMAC (mock, Sendcloud e endpoint); con la sandbox Sendcloud **non disponibile**, l'etichetta reale di test resta da generare.
- Test: 6 unitari `packages/shipping` (contratto Sendcloud, mock), 2 integrazione API (checkout integrato e punti di ritiro, webhook HMAC e duplicati, tracking della spedizione autonoma), 2 integrazione worker (etichetta e tracking fino a `DELIVERED`; annullamento con addebito), e2e J2 (9 e2e in totale).
- Correzione: Payment Element con `PAYMENT_PROVIDER=stripe` (bug della Fase 6).
- Decisioni: ADR-0041.

**Da fare con le credenziali Sendcloud**
- `SHIPPING_PROVIDER=sendcloud`, chiavi in `.env`, webhook dell'integrazione verso `/api/v1/webhooks/shipping/sendcloud`; generare un'etichetta di test e verificare metodi, mittente e mappatura degli stati.

**Rimandato**
- Ticket di supporto per eccezioni e resi al mittente (Fase 11), tracking multi-corriere per la spedizione autonoma (dopo l'MVP), riconciliazione delle fatture del provider (Fase 11).
