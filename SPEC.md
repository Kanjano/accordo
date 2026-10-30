# SPEC.md — Marketplace di strumenti musicali con pagamento protetto e feedback verificati

> **Codename provvisorio:** `accordo` (sostituiscilo ovunque con il nome definitivo con un cerca-e-sostituisci).
> **Versione documento:** 1.0 — 30 ottobre 2026 (versioni delle librerie verificate a questa data).
> **Destinatario:** Claude Code. Il documento è in italiano; il codice va scritto in inglese (glossario al §18).

---

## Come usare questo file (istruzioni per te, non per Claude Code)

1. Crea una cartella vuota per il progetto (es. `accordo/`) e copia dentro questo file chiamandolo `SPEC.md`.
2. Installa sul computer: **Node.js 26 LTS**, **pnpm**, **Docker Desktop** (o Docker Engine + Compose), **Git**, **Stripe CLI**. Crea un account **Stripe** e resta in modalità test.
3. Apri un terminale nella cartella e avvia Claude Code (`claude`).
4. Incolla questo messaggio:

   > Leggi tutto `SPEC.md`. Poi implementa il progetto seguendo il Piano di lavoro (§16), una fase alla volta, partendo dalla Fase 0. Alla fine di ogni fase esegui lint, typecheck e test, aggiorna `docs/PROGRESS.md`, fai un commit e fermati: mostrami un riepilogo e i comandi per verificare. Non passare alla fase successiva finché non te lo dico.

5. A fine fase controlla i "Criteri di accettazione" e rispondi "procedi con la Fase N".
6. Le chiavi reali (Stripe, Google, spedizioni, email) vanno solo nel file `.env` locale; Claude Code creerà `.env.example` con l'elenco completo.

> **Attenzione.** Commissioni, tempi, prezzi di spedizione e soglie indicati qui sono **valori di esempio** da validare con il tuo modello di business. Gli aspetti legali e fiscali (§14) vanno verificati con un avvocato e un commercialista prima del lancio.

---

## Indice

0. Istruzioni operative per Claude Code
1. Visione del prodotto
2. Ambito: MVP e fasi successive
3. Requisiti funzionali
4. Stack tecnologico
5. Architettura
6. Pagamento protetto (cuore del sistema)
7. Spedizioni e consegna a mano
8. Feedback e reputazione
9. Ricerca
10. Modello dati (schema Prisma completo)
11. API
12. Frontend
13. Sicurezza e anti-frode
14. Conformità normativa (Italia/UE)
15. Qualità, osservabilità, CI/CD e deploy
16. Piano di lavoro per fasi
17. Configurazione: `.env.example`, Docker Compose, script
18. Glossario italiano → codice
19. Dati di seed
20. Definition of Done finale e riferimenti

---

## 0. Istruzioni operative per Claude Code

Sei il lead engineer del progetto. Devi creare da zero, in questa cartella, un **monorepo completo e funzionante**: frontend, backend, database, worker, infrastruttura locale, test, CI e documentazione del marketplace descritto in questo file.

### 0.1 Regole di lavoro

1. **Lavora per fasi** (§16). Ogni fase termina con `pnpm lint && pnpm typecheck && pnpm test` verdi, documentazione aggiornata, un commit con messaggio convenzionale (`feat:`, `fix:`, `chore:`…) e un riepilogo per l'utente. Poi **fermati** e attendi conferma.
2. **Prima di scrivere codice** in una fase, rileggi le sezioni della SPEC che la fase richiama e annota un piano sintetico in `docs/PROGRESS.md`.
3. **Versioni.** Usa le ultime versioni **stabili** (mai alpha/beta/rc) che rispettano i minimi del §4. Controlla con `npm view <pacchetto> dist-tags` prima di installare: alcuni pacchetti hanno il tag `latest` su una release candidate (alla data di questo documento succede con `prisma`, il cui `latest` è `8.0.0-rc.*`: installa esplicitamente `prisma@7` e `@prisma/client@7`). Fissa le versioni nel lockfile.
4. **Documentazione ufficiale prima di tutto.** Le API cambiano. Se qualcosa qui non corrisponde alla documentazione della versione installata, segui la documentazione ufficiale e registra la deviazione in `docs/DECISIONS.md` (ADR breve: contesto, decisione, conseguenze). Per Stripe consulta sempre i documenti aggiornati (anche via `stripe docs` della Stripe CLI o i tool ufficiali per agenti, se disponibili).
5. **Ambiguità.** Se un requisito è ambiguo, scegli l'opzione più semplice e sicura, annotala in `docs/DECISIONS.md` e prosegui. Chiedi all'utente solo per decisioni irreversibili o che toccano denaro reale.
6. **Lingua.** Codice, identificatori, commenti, commit, nomi di tabelle e colonne in **inglese** (glossario §18). Tutti i testi dell'interfaccia in **italiano** tramite i18n: nessuna stringa visibile hard-coded nei componenti.
7. **Denaro.** Importi sempre in **centesimi interi** (`Int`) con valuta esplicita (`EUR`). Mai `float` per gli importi. Ogni operazione che muove denaro è idempotente, transazionale, registrata nel ledger (§6.9) e coperta da test.
8. **Segreti.** Mai nel repository. Crea `.env.example` completo (§17); `.env` è in `.gitignore`.
9. **Proprietà intellettuale.** Il sito di riferimento (mercatinomusicale.com) è solo un'ispirazione **funzionale**. Non copiare testi, loghi, grafica, immagini o dati; **nessuno scraping**. I contenuti demo sono generati (Faker con locale italiano, immagini segnaposto create localmente).
10. **Qualità.** TypeScript `strict`, niente `any` non giustificati, test per tutta la logica di dominio, accessibilità WCAG 2.2 AA, zero errori in console.
11. **`CLAUDE.md`.** Nella Fase 0 crea `CLAUDE.md` alla radice con comandi principali, struttura delle cartelle, convenzioni e le regole di questa sezione, così le sessioni future hanno il contesto senza rileggere tutta la SPEC.
12. **Regole d'oro del dominio** (da copiare anche in `CLAUDE.md`):
    - Lo stato di un ordine cambia **solo** tramite `OrderStateMachine` (§6.4) e `OrdersService.transition()`; mai `update` diretti sulla colonna `status`.
    - Nessun modulo chiama Stripe o il provider di spedizioni direttamente: si passa dalle porte `PaymentProvider` / `ShippingProvider` (§5.4).
    - Ogni scrittura che deve generare effetti esterni (email, indicizzazione, trasferimenti) scrive un evento nella tabella outbox **nella stessa transazione** (§5.4).
    - Il feedback si può lasciare solo su ordini `COMPLETED` (§8).

---

## 1. Visione del prodotto

### 1.1 Cosa costruiamo

Un marketplace italiano per comprare e vendere **strumenti musicali e attrezzatura audio, DJ e luci, nuovi e usati**, tra privati e negozi. Dal punto di vista funzionale si ispira ai portali di annunci del settore: annunci gratuiti, reparti per tipo di strumento, etichette "usato privato / usato negozio", vetrine dei negozi, sezione artigiani e liutai, ricerche salvate con avvisi, preferiti, utenti seguiti, mappa del sito per regioni e marche. A questo aggiunge tre pilastri che un portale di soli annunci non offre:

1. **Pagamento protetto** (modello "protezione acquisti" dei marketplace tra privati): l'acquirente paga sulla piattaforma; i soldi restano trattenuti finché conferma la ricezione, oppure finché scade la finestra di verifica senza contestazioni; solo allora vengono trasferiti al venditore. Include spedizione integrata con tracking, consegna a mano con codice di conferma, controversie e rimborsi.
2. **Feedback verificati in stile eBay**: positivo/neutro/negativo con commento, valutazioni dettagliate a stelle, punteggio, percentuale di positivi negli ultimi 12 mesi, livelli e badge "Venditore Top". Si lasciano solo dopo un ordine reale concluso sulla piattaforma.
3. **Sicurezza anti-truffa**: chat interna con filtri, link esterni non cliccabili, autenticazione rafforzata sulle azioni che sbloccano denaro, verifica d'identità dei venditori tramite il provider di pagamento.

### 1.2 Ruoli

| Ruolo | Cosa fa |
|---|---|
| Visitatore | Naviga e cerca senza account |
| Acquirente | Contatta, fa offerte, compra con pagamento protetto, apre controversie, lascia feedback |
| Venditore privato | Pubblica annunci gratis; per incassare con pagamento protetto completa la verifica d'identità (KYC) del provider |
| Negozio | Venditore professionale con P.IVA: vetrina, dati legali visibili, etichetta "negozio" sugli annunci |
| Artigiano / servizi | (Fase 2) Liutai, riparatori, sale prova, insegnanti con scheda nella directory |
| Moderatore | Code di revisione, segnalazioni, azioni motivate su annunci, utenti e feedback |
| Supporto | Ordini, controversie, rimborsi |
| Amministratore | Tutto, incluse impostazioni della piattaforma (commissioni, tempi), catalogo e staff |

### 1.3 Principi

- **Fiducia prima di tutto**: ogni scelta di UX deve ridurre il rischio di truffa.
- **Mobile-first**, veloce, con le foto protagoniste.
- **SEO**: pagine annuncio, categoria e marca renderizzate lato server e indicizzabili.
- **Gratis per chi vende** (MVP): nessuna commissione sul venditore. La piattaforma guadagna dalla commissione di protezione acquisti pagata dall'acquirente (configurabile, §6.3).
- **Conformità UE/IT by design** (§14).

---

## 2. Ambito: MVP e fasi successive

| Area | MVP (Fasi 0–12) | Fase 2+ (roadmap §16.2) |
|---|---|---|
| Account | Email+password, Google, verifica email, 2FA TOTP, passkey, profilo pubblico | Apple ID, verifica telefono via SMS |
| Annunci | "Vendo"; 12 reparti; attributi per categoria; fino a 20 foto; durata 60 giorni; rinnovo gratuito | Annunci "Cerco", video, promozioni a pagamento |
| Ricerca | Full-text tollerante agli errori, filtri e faccette, raggio geografico, ricerche salvate con avvisi email | Mappa, avvisi push, stima del prezzo dell'usato |
| Chat e offerte | Chat in tempo reale con filtri anti-truffa, offerte con controproposta | Risposte rapide per negozi |
| Pagamenti | Pagamento protetto (Stripe Connect), consegna a mano con codice, spedizione autonoma tracciata | Pagamento a rate, multi-valuta |
| Spedizioni | Spedizione integrata via provider (adapter) + provider finto per sviluppo; taglie pacco | Ritiro a domicilio, assicurazione aggiuntiva |
| Feedback | Sistema completo (§8) | Recensioni dei servizi degli artigiani |
| Negozi | Vetrina, dati legali, badge "verificato" | Abbonamento PRO, import CSV/feed, statistiche |
| Backoffice | Moderazione, segnalazioni DSA, ordini, controversie, rimborsi, impostazioni, audit, export DAC7 | BI avanzata |
| Contenuti | Guide, FAQ e pagine legali in MDX | CMS headless, sezione News |
| App | Web responsive + PWA installabile | App native (Expo) sulla stessa API |

---

## 3. Requisiti funzionali

### 3.1 Account e profili

- **Registrazione** con email e password (minimo 10 caratteri) oppure Google. Accettazione di Termini e Privacy con timestamp; consenso marketing separato e facoltativo.
- **Verifica email** obbligatoria prima di pubblicare annunci, scrivere messaggi o comprare.
- **Accesso** con email/password, Google o passkey. **2FA TOTP** con codici di backup: obbligatoria per lo staff, consigliata ai venditori.
- **Autenticazione rafforzata (step-up)** per le azioni sensibili: conferma di ricezione, visualizzazione del codice di consegna a mano, cambio email/password, disattivazione 2FA, invio dati fiscali, onboarding pagamenti. Si richiede una nuova autenticazione se l'ultima ha più di 10 minuti **oppure** se il dispositivo è stato visto per la prima volta meno di 24 ore fa (§13.3).
- **Profilo pubblico** `/utente/[username]`: avatar, nome visualizzato, comune (mai l'indirizzo), "membro dal", attività approssimata ("attivo oggi / questa settimana"), tempo medio di risposta, badge (email verificata, identità verificata, negozio verificato, Venditore Top, livello), riepilogo feedback, annunci attivi, pulsanti Segui e Segnala.
- **Impostazioni**: profilo; indirizzi di spedizione e mittente; sicurezza (password, 2FA, passkey, sessioni attive con revoca); notifiche (matrice tipo × canale); privacy (esporta i miei dati, elimina account, bloccata se ci sono ordini aperti); dati fiscali DAC7 quando richiesti (§14).
- **Blocco utenti**: un utente bloccato non può scriverti né farti offerte.

### 3.2 Catalogo

- **12 reparti** con categorie e sottocategorie (seed al §19), **attributi dinamici per categoria** definiti nel database e validati lato server, **marche** con alias per normalizzare le varianti ("fender", "Fender USA"), **modello** a testo libero.
- **Condizioni**: Nuovo, Come nuovo, Ottime condizioni, Buone condizioni, Discrete condizioni, Da riparare / per ricambi, ciascuna con una spiegazione nel form.
- **Etichetta del tipo di venditore** su ogni annuncio: "Usato privato", "Usato negozio", "Nuovo negozio".
- Alcune categorie non sono spedibili (es. pianoforti acustici, organi a consolle): solo consegna a mano.

### 3.3 Annunci

- **Wizard "Vendi" in 5 passi** con salvataggio automatico della bozza:
  1. categoria (suggerita automaticamente dal titolo);
  2. dettagli: titolo (max 120 caratteri), marca, modello, anno, condizione, attributi della categoria, descrizione (max 5.000 caratteri, testo semplice);
  3. foto: da 1 a 20, trascinamento, riordino, rotazione; la prima è la copertina;
  4. prezzo e consegna: prezzo, "trattabile", "valuto scambi", **pagamento protetto** (richiede l'onboarding del §6.2), spedizione integrata (taglia pacco suggerita dalla categoria), spedizione autonoma (prezzo a carico dell'acquirente), consegna a mano;
  5. anteprima e pubblicazione.
- **Pubblicazione**: controlli automatici (§13.5), poi `ACTIVE` oppure `PENDING_REVIEW`.
- **Ciclo di vita**: durata 60 giorni, promemoria a 7 giorni e a 1 giorno dalla scadenza, rinnovo gratuito, "rialza" gratuito al massimo una volta ogni 7 giorni (aggiorna `bumpedAt`).
- **Azioni**: modifica (le modifiche sostanziali, cioè categoria, foto o prezzo ridotto di oltre il 50%, ripassano i controlli), pausa, "segna come venduto" (vendita fuori piattaforma), elimina (soft delete).
- **Storico prezzi**: un ribasso notifica chi ha l'annuncio nei preferiti. Per i **negozi**, un badge di ribasso deve mostrare il prezzo più basso degli ultimi 30 giorni (§14).
- **Pagina annuncio**: galleria (swipe, zoom, tastiera), prezzo, badge (Pagamento protetto, Spedizione disponibile, Consegna a mano, Trattabile, Valuto scambi), tabella attributi, descrizione, posizione approssimata (comune e provincia), scheda venditore con reputazione, pulsanti "Compra con pagamento protetto", "Fai un'offerta", "Contatta", preferito, condividi, segnala; consigli di sicurezza; annunci simili. Il contatore visualizzazioni è visibile solo al venditore.
- **Annunci venduti**: restano visibili 30 giorni con l'etichetta "Venduto" e annunci simili, poi `noindex`.

### 3.4 Ricerca e navigazione

Dettagli tecnici al §9.

- Barra di ricerca con **autocompletamento** (marche, modelli, categorie), **filtri e faccette** con conteggi, **ordinamenti** (rilevanza, più recenti, prezzo crescente/decrescente, distanza).
- Card risultato: foto, titolo, prezzo, condizione, comune e provincia, data, badge, venditore con percentuale di feedback positivi.
- Paginazione con URL condivisibili; scroll infinito su mobile.
- **Ricerche salvate** con avvisi istantanei o riepilogo giornaliero alle 8:00 (Europe/Rome); **preferiti**; **visti di recente** (anche per utenti anonimi, in localStorage); **utenti seguiti** con feed dei loro nuovi annunci.
- **Pagine SEO**: reparto, categoria, categoria + marca, marca; filtro per regione via query string.

### 3.5 Messaggistica

- Una conversazione per coppia (annuncio, acquirente). Tempo reale via WebSocket con fallback a polling. Stato "letto", immagini (max 5 per messaggio, stessi controlli delle foto degli annunci).
- **Messaggi di sistema** per gli eventi (offerta ricevuta, ordine pagato, spedito…).
- **Filtri anti-truffa** e banner di sicurezza contestuali (§13.4).
- Limiti: account con meno di 7 giorni possono aprire al massimo 10 nuove conversazioni al giorno; blocco utente; segnalazione di un messaggio.

### 3.6 Offerte

- Disponibili solo su annunci "trattabili" con pagamento protetto attivo.
- L'acquirente propone un importo (minimo 50% del prezzo, configurabile); il venditore accetta, rifiuta o fa una controproposta. Scadenza 48 ore. Massimo 3 offerte attive per acquirente e annuncio.
- Un'offerta accettata riserva l'annuncio per 24 ore all'acquirente, che completa il checkout al prezzo concordato.

### 3.7 Pagamento protetto, spedizioni, feedback

Vedi §6, §7 e §8.

### 3.8 Negozi

- Richiesta "Diventa negozio": ragione sociale, P.IVA (validazione formale del codice di controllo), indirizzo della sede, email, telefono, numero REA facoltativo, autocertificazione DSA (§14), logo e copertina, descrizione, orari, politica resi e informazioni sulla garanzia. Verifica manuale dello staff e badge "Negozio verificato".
- Vetrina `/negozio/[slug]`, elenco negozi filtrabile per regione, informazioni legali visibili anche sulla pagina annuncio.

### 3.9 Notifiche

Canali: in-app (campanella in tempo reale), email, web push (fase 2). Preferenze per tipo e canale; le notifiche transazionali e di sicurezza non si possono disattivare.

Eventi: nuovo messaggio; offerta ricevuta, accettata, rifiutata, controproposta, scaduta; ordine pagato (al venditore); promemoria di spedizione 24 ore prima della scadenza; spedito; consegnato; promemoria di conferma ricezione; fondi trasferiti; controversia aperta, aggiornata, risolta; feedback ricevuto e promemoria per lasciarlo; richiesta di revisione feedback; nuovi risultati per una ricerca salvata; ribasso di un preferito; annuncio in scadenza o scaduto; annuncio approvato o rifiutato (con motivazione); nuovo accesso da dispositivo sconosciuto; password cambiata; richiesta dati DAC7.

### 3.10 Backoffice (`/admin`)

Accesso con ruolo staff, 2FA obbligatoria e step-up recente. Sezioni:

- dashboard KPI (GMV, ordini per stato, tasso di controversie, tempi medi di spedizione, code in arretrato);
- coda di moderazione annunci; segnalazioni (notice & action DSA) con decisione motivata; ricorsi;
- utenti: ricerca, dettaglio, sanzioni (avviso, limitazione, sospensione, ban) con motivazione; impersonificazione **in sola lettura** con banner e audit;
- ordini, rimborsi, controversie (con strumenti di decisione), chargeback;
- feedback: rimozione per violazioni con motivazione;
- catalogo: reparti, categorie, attributi, marche;
- impostazioni della piattaforma: commissioni, tempi, taglie e prezzi pacco, parole vietate, feature flag;
- negozi: richieste e verifiche;
- DAC7: venditori sopra soglia, solleciti, export;
- audit log, log dei webhook, pannello delle code (Bull Board).

### 3.11 Contenuti

Pagine MDX versionate nel repo: Come funziona il pagamento protetto; Sicurezza e anti-truffa; Come imballare e spedire uno strumento; Consegna a mano in sicurezza; Regole di pubblicazione e articoli vietati; Come funzionano i feedback (informativa sulla verifica delle recensioni, §14); FAQ; Termini di servizio; Condizioni del pagamento protetto; Privacy; Cookie; Note legali e punto di contatto DSA. I testi legali sono **segnaposto** marcati "DA VALIDARE CON IL LEGALE".

---

## 4. Stack tecnologico

Versioni verificate al 30/10/2026. Regola generale: ultima versione **stabile** che rispetta il minimo indicato.

| Livello | Scelta | Versione minima | Motivazione |
|---|---|---|---|
| Runtime | Node.js | 26 LTS | Active LTS dal 28/10/2026, supporto fino ad aprile 2029. `.nvmrc` = `26` |
| Monorepo | pnpm workspaces + Turborepo | pnpm stabile, Turbo 2.x | build incrementali con cache |
| Linguaggio | TypeScript `strict` | 6.0.x | TS 7 (compilatore nativo) non è ancora supportato da tutto il tooling, ad esempio la CLI di NestJS; valutare il passaggio con un ADR quando l'ecosistema è pronto |
| Lint e format | Biome | 2.x | un solo strumento, veloce |
| Frontend | Next.js (App Router, React Server Components, Turbopack) + React | 16.4 / 19.3 | SSR e SEO, streaming, caching. Next.js pubblica patch di sicurezza mensili: tenerlo aggiornato |
| UI | Tailwind CSS + shadcn/ui (Radix) + lucide-react | Tailwind 4.x | componenti accessibili e personalizzabili |
| Dati lato client | TanStack Query | 5.x | cache, retry, aggiornamenti ottimistici |
| Form e validazione | React Hook Form + Zod | Zod 4.x | schemi condivisi tra frontend e backend |
| i18n | next-intl | 4.x | `it` predefinito, `en` predisposto |
| UI pagamenti | Stripe.js + React Stripe.js (Payment Element) | ultime stabili | SCA/3DS gestiti da Stripe |
| Backend | NestJS (adapter Express) | 12.x | moduli, DI, guard; ESM; supporto Standard Schema (Zod) nei decorator di route |
| Autenticazione | Better Auth + adapter Prisma + integrazione NestJS `@thallesp/nestjs-better-auth` (mantenuta dalla community) | 1.7.x | sessioni su DB, OAuth, 2FA, passkey, plugin admin. Se l'integrazione NestJS dà problemi, montare l'handler Node di Better Auth su una route Express (ADR) |
| ORM | Prisma ORM | 7.x stabile (≥ 7.10) | URL di connessione in `prisma.config.ts`, generator `prisma-client` con `output` obbligatorio, driver adapter `@prisma/adapter-pg` |
| Database | PostgreSQL | 18 | JSONB, indici parziali, `pg_trgm` |
| Cache, code, rate limit, pub/sub | Valkey (compatibile Redis) | 8.x | BullMQ, adapter Socket.IO |
| Job | BullMQ + `@nestjs/bullmq` | 6.x | job ritardati, retry, Bull Board |
| Realtime | Socket.IO + adapter Redis | 4.x | chat e notifiche |
| Ricerca | Meilisearch Community Edition | ultima 1.x | tolleranza agli errori, faccette, ricerca geografica. Solo l'ultima release riceve correzioni: fissa il tag Docker e aggiorna spesso |
| Object storage (produzione) | S3 compatibile, consigliato Cloudflare R2 con giurisdizione UE | — | immagini dietro CDN |
| Object storage (sviluppo) | RustFS (alternativa: SeaweedFS) | — | la Community Edition di MinIO non pubblica più immagini Docker |
| Pagamenti | Stripe Connect: Accounts v2, configurazione "marketplace", separate charges and transfers; Radar | SDK `stripe` ultimo | provider autorizzato, KYC dei venditori, SCA |
| Spedizioni | Provider multi-corriere dietro adapter: Sendcloud **oppure** ShippyPro (scelta in base a contratto e tariffe) + adapter finto | — | etichette, tracking, punti di ritiro, webhook |
| Email | React Email + provider transazionale con data center UE (Resend, Postmark o Amazon SES); Mailpit in sviluppo | — | template tipizzati in italiano |
| Anti-bot | Cloudflare Turnstile | — | CAPTCHA rispettoso della privacy |
| Immagini | sharp | 0.35+ | varianti, rimozione EXIF, hash percettivo |
| Osservabilità | Sentry + OpenTelemetry + pino | — | errori, tracce, log JSON |
| Test | Vitest, Playwright, Testcontainers, axe-core, k6 | Vitest 5, Playwright 1.6x | unit, integrazione, e2e, accessibilità, carico |
| CI/CD | GitHub Actions, Docker, GHCR | — | pipeline riproducibile |

**Hosting consigliato (non vincolante, tutto in UE):** web su Vercel (regione UE) o container; API e worker su container (Fly.io, Render, Railway o VM Hetzner con Coolify); PostgreSQL gestito con PITR; Valkey gestito; Meilisearch Cloud (UE) o self-hosted; R2 per i media; Sentry con data residency UE.

**Alternative di pagamento** da tenere aperte grazie alla porta `PaymentProvider`: Mangopay, Adyen for Platforms. Non implementarle nell'MVP.

---

## 5. Architettura

### 5.1 Vista d'insieme

```mermaid
flowchart LR
  subgraph Client
    B[Browser / PWA]
  end
  subgraph App
    WEB["apps/web<br/>Next.js 16"]
    API["apps/api<br/>NestJS 12<br/>REST + WebSocket"]
    WRK["apps/worker<br/>BullMQ + scheduler"]
  end
  subgraph Dati
    PG[(PostgreSQL 18)]
    RD[(Valkey)]
    MS[(Meilisearch)]
    S3[(Object storage)]
  end
  subgraph Esterni
    STRIPE[Stripe Connect]
    SHIP[Provider spedizioni]
    MAIL[Provider email]
  end
  B -->|pagine| WEB
  B -->|"/api e /ws"| API
  B -->|upload con URL firmato| S3
  WEB -->|fetch lato server| API
  API --> PG
  API --> RD
  API --> MS
  API --> S3
  API --> STRIPE
  API --> SHIP
  WRK --> PG
  WRK --> RD
  WRK --> MS
  WRK --> S3
  WRK --> STRIPE
  WRK --> SHIP
  WRK --> MAIL
  STRIPE -->|webhook| API
  SHIP -->|webhook| API
```

- **apps/web**: sito pubblico, area personale, backoffice `/admin`. Non accede direttamente al database: parla solo con l'API.
- **apps/api**: monolite modulare NestJS. Unico punto di accesso al dominio. Espone REST `/api/v1`, Better Auth su `/api/auth/*`, WebSocket, webhook.
- **apps/worker**: stessa base di codice (moduli condivisi), avviato come applicazione NestJS standalone. Esegue i processori BullMQ, il dispatcher dell'outbox e i job pianificati.

### 5.2 Struttura del repository

```text
accordo/
├─ apps/
│  ├─ web/                    # Next.js 16 (App Router)
│  │  ├─ app/[locale]/...     # route (vedi §12)
│  │  ├─ components/          # componenti di pagina
│  │  ├─ content/             # pagine MDX (guide, legali)
│  │  ├─ messages/it.json     # traduzioni
│  │  └─ proxy.ts             # i18n, header di sicurezza/CSP con nonce
│  ├─ api/                    # NestJS 12
│  │  └─ src/modules/<modulo>/  # controller, service, repository, dto, test
│  └─ worker/                 # NestJS standalone: processori, scheduler, outbox dispatcher
├─ packages/
│  ├─ db/                     # schema Prisma, migrazioni, client generato, seed, prisma.config.ts
│  ├─ domain/                 # logica pura senza I/O: importi, macchina a stati, reputazione, anti-frode
│  ├─ shared/                 # contratti Zod (DTO), enum, costanti, tipi condivisi
│  ├─ sdk/                    # client API tipizzato (usato da web e future app)
│  ├─ ui/                     # design system (shadcn/ui + preset Tailwind)
│  ├─ emails/                 # template React Email
│  └─ config/                 # tsconfig base, preset Vitest, config Biome
├─ e2e/                       # test Playwright
├─ infra/
│  ├─ docker/                 # Dockerfile.web, Dockerfile.api, Dockerfile.worker
│  ├─ compose/                # docker-compose.yml (sviluppo), docker-compose.prod.example.yml
│  └─ caddy/                  # reverse proxy di esempio
├─ scripts/                   # import geografico, reindicizzazione, seed massivo
├─ docs/                      # ARCHITECTURE, DECISIONS, PAYMENTS, FEEDBACK, SECURITY, COMPLIANCE, RUNBOOK, PROGRESS, DATA_SOURCES
├─ .github/workflows/         # ci.yml, deploy.yml
├─ CLAUDE.md
├─ README.md
├─ package.json  pnpm-workspace.yaml  turbo.json  biome.json  .nvmrc  .env.example
```

### 5.3 Moduli dell'API

| Modulo | Responsabilità |
|---|---|
| `auth` | Better Auth, guard di sessione e ruoli, step-up, dispositivi noti |
| `users` | profili, impostazioni, indirizzi, follow, blocchi, export e cancellazione GDPR |
| `shops` | richieste negozio, dati legali, verifica |
| `catalog` | reparti, categorie, attributi, marche |
| `geo` | regioni, province, comuni, autocompletamento |
| `listings` | CRUD, ciclo di vita, slug, prezzi, controlli di pubblicazione |
| `media` | URL di upload firmati, collegamento immagini, pipeline di elaborazione |
| `search` | indicizzazione, query, suggerimenti, ricerche salvate |
| `engagement` | preferiti, visti di recente, feed seguiti |
| `messaging` | conversazioni, messaggi, gateway WebSocket, filtri anti-truffa |
| `offers` | offerte e controproposte |
| `orders` | checkout, macchina a stati, timer, consegna a mano |
| `payments` | porta `PaymentProvider`, adapter Stripe, account connessi, webhook, ledger, riconciliazione |
| `shipping` | porte `ShippingProvider` e `TrackingProvider`, adapter, webhook di tracking |
| `disputes` | controversie, prove, proposte, decisioni, resi, chargeback |
| `feedback` | feedback, risposte, revisioni, aggregati di reputazione, badge |
| `notifications` | in-app, email, push, preferenze |
| `moderation` | segnalazioni, regole automatiche, azioni motivate, ricorsi |
| `admin` | endpoint di backoffice, impostazioni della piattaforma |
| `compliance` | DAC7, informative, conservazione dei dati |
| `platform` | outbox, idempotenza, audit, feature flag, health check |

### 5.4 Pattern obbligatori

1. **Monolite modulare.** I moduli comunicano tramite service pubblici o eventi di dominio, mai accedendo alle tabelle di altri moduli.
2. **Porte e adapter** per ogni servizio esterno, ognuno con un'implementazione finta per test e sviluppo: `PaymentProvider` (Stripe), `ShippingProvider` e `TrackingProvider` (Mock, Sendcloud o ShippyPro), `EmailProvider` (SMTP/Mailpit, provider di produzione), `StorageProvider` (S3), `SearchIndex` (Meilisearch), `CaptchaVerifier` (Turnstile).
3. **Outbox transazionale.** Gli eventi di dominio (`listing.published`, `order.paid`…) si scrivono nella tabella `OutboxEvent` nella stessa transazione del cambiamento di stato. Il dispatcher nel worker li pubblica sulle code BullMQ. I consumer sono idempotenti.
4. **Macchina a stati pura** in `packages/domain`: `transition(order, event, ctx) → { nextStatus, effects[] }`. `OrdersService` la applica con **lock ottimistico** (colonna `version`), scrive `OrderEvent` e gli eventi outbox; gli effetti (trasferimenti, email, etichette) li esegue il worker.
5. **Timer guidati dal database.** Ogni ordine ha `nextAction` e `nextActionAt`. Uno *sweeper* ogni minuto prende gli ordini scaduti con `SELECT … FOR UPDATE SKIP LOCKED` e invia l'evento corrispondente. I job ritardati di BullMQ sono solo un'ottimizzazione: la fonte di verità è il database.
6. **Idempotenza.** Header `Idempotency-Key` obbligatorio sugli endpoint che muovono denaro (tabella `IdempotencyKey`, 24 ore). Chiavi di idempotenza Stripe deterministiche, per esempio `transfer:{orderId}` o `refund:{orderId}:{n}`. Webhook deduplicati per id evento.
7. **Contratti condivisi.** Gli schemi Zod in `packages/shared` validano le richieste nell'API e i form nel web. Il documento OpenAPI 3.1 si genera dai contratti (Zod 4 converte nativamente in JSON Schema, oppure una libreria come `nestjs-zod`) ed è pubblicato su `/api/docs` in sviluppo e staging. `packages/sdk` è il client tipizzato. Se la generazione automatica risulta fragile, mantieni i contratti Zod come fonte di verità e scrivi a mano il client in `packages/sdk` (ADR).
8. **Errori** nel formato Problem Details (RFC 9457) con `code` applicativo stabile.

### 5.5 Autenticazione e sessioni

- Topologia di produzione: web su `www.<dominio>`, API su `api.<dominio>`. Cookie di sessione di Better Auth condiviso sui sottodomini (`Domain=.<dominio>`, `HttpOnly`, `Secure`, `SameSite=Lax`). CORS con allowlist e credenziali.
- I Server Component di Next.js inoltrano i cookie della richiesta all'API tramite `packages/sdk`.
- In sviluppo web (porta 3000) e API (porta 4000) sono entrambe su `localhost`: i cookie valgono per entrambe le porte.
- Configura Better Auth per usare gli id generati dal database (opzione `generateId` nelle impostazioni avanzate del database; verifica il nome esatto nella documentazione della versione installata) e i plugin: admin, username, twoFactor, passkey, phoneNumber (quest'ultimo predisposto ma disattivato nell'MVP).
- Ruoli: `user`, `moderator`, `support`, `admin` (campo `role` del plugin admin). Autorizzazione a livello di risorsa con policy esplicite: ogni endpoint verifica la proprietà della risorsa (test anti-IDOR).
- Le sessioni in impersonificazione (`impersonatedBy` valorizzato) possono solo leggere: un guard globale blocca le richieste di modifica.

### 5.6 Realtime

Gateway Socket.IO nell'API con adapter Redis (scalabile su più istanze). Autenticazione con il cookie di sessione durante l'handshake. Stanze `user:{id}` e `conversation:{id}`. Eventi: `message:new`, `conversation:read`, `notification:new`, `order:updated`, `offer:updated`.

### 5.7 Code e job pianificati (worker)

| Coda / job | Trigger | Cosa fa |
|---|---|---|
| `outbox-dispatcher` | continuo | pubblica gli eventi outbox sulle code |
| `search-index` | eventi annuncio | upsert o rimozione dei documenti Meilisearch |
| `media` | immagine caricata | verifica, rimozione EXIF, varianti, LQIP, hash percettivo |
| `notifications` | eventi | in-app, email, push secondo le preferenze |
| `order-sweeper` | ogni minuto | esegue le azioni scadute degli ordini |
| `payments` | eventi ordine | trasferimenti, rimborsi, storni con chiavi idempotenti |
| `shipping` | ordine pagato / eventi | creazione spedizioni ed etichette, registrazione tracking |
| `saved-search-alerts` | ogni 10 minuti + digest alle 8:00 | avvisi ricerche salvate |
| `listing-lifecycle` | ogni ora | scadenze, promemoria, archiviazione dei venduti |
| `reputation` | eventi feedback/ordine + notte | ricalcolo aggregati e badge |
| `reconciliation` | ogni notte | confronto movimenti Stripe ↔ ledger, alert sulle differenze |
| `funds-hold-guard` | ogni notte | alert sugli ordini con fondi trattenuti da oltre 60 giorni |
| `dac7` | ogni notte + annuale | monitoraggio soglie, solleciti, export |
| `sitemaps` | ogni ora | rigenerazione delle sitemap |
| `cleanup` | ogni notte | upload orfani, chiavi di idempotenza scadute, purge secondo le regole di conservazione |

### 5.8 Caching e invalidazione

- Next.js: Cache Components (`"use cache"`) per l'albero del catalogo, le marche e i contenuti statici; pagine annuncio, categoria e profilo con tag di cache (`listing:{id}`, `category:{id}`, `user:{id}`).
- L'API, quando un annuncio cambia, chiama l'endpoint di revalidate del web (protetto da secret condiviso) con i tag da invalidare. Questo avviene via outbox.
- Valkey per letture calde dell'API: catalogo, aggregati di reputazione, impostazioni della piattaforma (TTL breve e invalidazione esplicita).
- I risultati di ricerca non si mettono in cache (Meilisearch è già veloce).

### 5.9 Pipeline dei media

1. Il client ridimensiona e comprime le foto prima del caricamento (lato lungo massimo 2560 px) e accetta solo JPEG, PNG e WebP. Le foto HEIC vanno convertite dal browser; se non è possibile, messaggio chiaro all'utente.
2. Il client chiede all'API un URL di upload firmato (POST con policy: tipo di contenuto, dimensione massima 15 MB, chiave `uploads/tmp/{userId}/{uuid}`).
3. Dopo l'upload il client chiama l'API per collegare l'immagine all'annuncio; il worker:
   - verifica i *magic bytes* del file;
   - decodifica con sharp applicando l'orientamento EXIF e **rimuove tutti i metadati**, GPS incluso (test obbligatorio);
   - genera le varianti WebP 320, 640, 1280 e 2048 px più un JPEG 1280 per email e Open Graph;
   - calcola un placeholder sfocato (LQIP) e un hash percettivo (dHash a 64 bit) per scoprire foto riutilizzate da account diversi (§13.5);
   - salva su `listings/{listingId}/{imageId}/{width}.webp` nel bucket pubblico servito dalla CDN.
4. Le prove delle controversie vanno in un **bucket privato**, accessibile solo con URL GET firmati di 5 minuti.
5. In Next.js usa un loader personalizzato che sceglie la variante più vicina (niente ottimizzazione on-the-fly).

---

## 6. Pagamento protetto (cuore del sistema)

### 6.1 Principi non negoziabili

1. **Non è un "escrow" in senso legale.** Stripe dichiara di non fornire servizi né conti di escrow; offre invece strumenti per ritardare il trasferimento dei fondi ai venditori. Nell'interfaccia e nei testi legali parla di "Pagamento protetto" e "Protezione acquisti", mai di "escrow" o "deposito a garanzia".
2. **La piattaforma non custodisce mai denaro su conti propri.** Tutti i fondi passano da Stripe, che è un soggetto autorizzato. Prima del lancio descrivi a Stripe il modello di business (fondi trattenuti fino alla conferma di ricezione) e fatti confermare che il caso d'uso è approvato per il tuo account.
3. **Configurazione Connect "marketplace":**
   - la piattaforma è il *merchant of record*, paga le commissioni Stripe ed è responsabile dei saldi negativi degli account connessi;
   - gli account dei venditori si creano con **Accounts v2**: dashboard `express`, responsabilità delle perdite alla piattaforma (`defaults.responsibilities.losses_collector = application`), configurazione `recipient` con la capability `stripe_balance.stripe_transfers` richiesta, `identity.country = "it"`. Se Accounts v2 non fosse disponibile per l'account, usa Accounts v1 con account Express (ADR);
   - onboarding e KYC gestiti da Stripe: pagina ospitata (Account Link) oppure componente embedded di onboarding.
4. **Tipo di addebito: separate charges and transfers** (disponibile per l'Italia). Il pagamento si addebita sull'account della piattaforma con `transfer_group = order.transferGroup`. Al completamento si crea un **Transfer** verso il venditore con `source_transaction = chargeId`: Stripe accetta subito la richiesta ma esegue il trasferimento solo quando i fondi del pagamento sono disponibili.
5. **Limite di permanenza dei fondi.** Nei paesi diversi da Stati Uniti e Thailandia Stripe consente di trattenere i fondi al massimo 90 giorni. Regola interna: ogni ordine deve essere completato o rimborsato **entro 85 giorni** dal pagamento; alert allo staff a 60 giorni (job `funds-hold-guard`).
6. **Ambito MVP:** solo EUR, solo venditori con account connesso in Italia, solo spedizioni in Italia.
7. **Metodi di pagamento:** Payment Element con metodi automatici configurati dalla Dashboard Stripe: carte, Apple Pay, Google Pay, PayPal (se disponibile per l'account) e **Satispay** (supportato da Stripe anche con Connect). Niente addebito diretto SEPA nell'MVP (conferma lenta e rischio di storni).

### 6.2 Onboarding del venditore

- Il pagamento protetto si attiva per singolo annuncio. La prima attivazione avvia l'onboarding: l'API crea l'account connesso e restituisce il link di onboarding (o la sessione per il componente embedded). Finché `PaymentAccount.transfersEnabled = false` l'opzione resta disattivata e il wizard mostra "Attiva i pagamenti protetti (circa 5 minuti)".
- Lo stato dell'account (requirements, capability, motivi di disabilitazione) si sincronizza con gli eventi di Stripe su `PaymentAccount`.
- Se Stripe limita un account: gli annunci restano visibili ma senza "Compra"; gli ordini già pagati proseguono; i trasferimenti passano a `ON_HOLD` finché l'account non torna abilitato. Se l'ordine si avvicina al limite dei fondi trattenuti, il supporto decide (di norma rimborso).
- I bonifici dal saldo Stripe del venditore al suo IBAN seguono la pianificazione automatica giornaliera gestita da Stripe. Nella sezione "Incassi" il venditore vede saldo, trasferimenti e bonifici (componenti embedded di Connect o link alla Express Dashboard).

### 6.3 Calcolo degli importi

Tutto in centesimi, arrotondamento al centesimo *half-up* con aritmetica intera (percentuali espresse in basis point, `bps`). Funzione pura `computeOrderAmounts()` in `packages/domain`, con test a tabella.

```text
buyerFee      = clamp(round(itemPrice × BUYER_FEE_BPS / 10_000) + BUYER_FEE_FIXED_CENTS,
                      BUYER_FEE_MIN_CENTS, BUYER_FEE_MAX_CENTS)
buyerFeeVat   = round(buyerFee × 22 / 122)        # IVA inclusa nella commissione (da validare col commercialista)
shipping      = SHIPPING_INTEGRATED → prezzo della taglia pacco (§7.1)
                SHIPPING_SELF       → listing.selfShippingPriceCents
                HAND_DELIVERY       → 0
total         = itemPrice + shipping + buyerFee
sellerFee     = round(itemPrice × SELLER_COMMISSION_BPS / 10_000)       # 0 nell'MVP
sellerNet     = itemPrice − sellerFee + (SHIPPING_SELF ? shipping : 0)
```

Valori di esempio (segnaposto, configurabili da admin): `BUYER_FEE_BPS=400` (4%), `BUYER_FEE_FIXED_CENTS=50`, `BUYER_FEE_MIN_CENTS=100`, `BUYER_FEE_MAX_CENTS=2500`, `SELLER_COMMISSION_BPS=0`.

| Caso | Oggetto | Spedizione | Commissione acquirente | Totale pagato | Al venditore |
|---|---|---|---|---|---|
| Chitarra, spedizione integrata taglia L | 800,00 € | 12,90 € | 4% + 0,50 = 32,50 → tetto **25,00 €** (di cui IVA 4,51 €) | **837,90 €** | 800,00 € |
| Pedale, consegna a mano | 120,00 € | 0 | 4,80 + 0,50 = **5,30 €** | **125,30 €** | 120,00 € |
| Plettri, spedizione autonoma | 4,00 € | 2,50 € | 0,16 + 0,50 = 0,66 → minimo **1,00 €** | **7,50 €** | 6,50 € |

Tutti gli importi vengono "fotografati" sull'ordine al checkout: le modifiche successive delle impostazioni non toccano gli ordini esistenti. Le commissioni Stripe sono a carico della piattaforma e si registrano nel ledger leggendo la *balance transaction* del pagamento.

### 6.4 Macchina a stati dell'ordine

```mermaid
stateDiagram-v2
    [*] --> CHECKOUT_PENDING: checkout avviato
    CHECKOUT_PENDING --> PAID: pagamento riuscito, spedizione
    CHECKOUT_PENDING --> HANDOVER_PENDING: pagamento riuscito, consegna a mano
    CHECKOUT_PENDING --> PAYMENT_FAILED: pagamento rifiutato
    CHECKOUT_PENDING --> EXPIRED: prenotazione scaduta
    PAID --> SHIPPED: spedizione confermata
    PAID --> CANCELLED: annullato o termine di spedizione scaduto
    HANDOVER_PENDING --> COMPLETED: codice di consegna verificato
    HANDOVER_PENDING --> CANCELLED: consegna non avvenuta
    SHIPPED --> DELIVERED: consegnato
    SHIPPED --> COMPLETED: conferma acquirente o chiusura automatica
    SHIPPED --> DISPUTED: non ricevuto
    DELIVERED --> COMPLETED: conferma o 72 ore senza contestazioni
    DELIVERED --> DISPUTED: contestazione entro 72 ore
    DISPUTED --> COMPLETED: rilascio o rimborso parziale
    DISPUTED --> RETURN_IN_TRANSIT: reso richiesto
    DISPUTED --> REFUNDED: rimborso totale senza reso
    RETURN_IN_TRANSIT --> REFUNDED: reso ricevuto
    RETURN_IN_TRANSIT --> COMPLETED: reso non spedito in tempo
    COMPLETED --> [*]
    REFUNDED --> [*]
    CANCELLED --> [*]
    PAYMENT_FAILED --> [*]
    EXPIRED --> [*]
```

Transizioni (implementate come funzione pura con test per **ogni** riga e per le transizioni non ammesse):

| Da | Evento | A | Chi lo genera | Condizioni | Effetti principali |
|---|---|---|---|---|---|
| — | `CHECKOUT_STARTED` | `CHECKOUT_PENDING` | acquirente | annuncio `ACTIVE` con pagamento protetto; acquirente ≠ venditore; email verificata; nessun ordine attivo sull'annuncio | calcolo importi; PaymentIntent; `reservedUntil` = +15 min; annuncio non acquistabile da altri |
| `CHECKOUT_PENDING` | `PAYMENT_SUCCEEDED` | `PAID` o `HANDOVER_PENDING` | webhook | importo e valuta coincidono | ledger; annuncio `RESERVED`; `shipBy` = +5 giorni lavorativi oppure codice di consegna e scadenza a 7 giorni; etichetta se spedizione integrata; notifiche |
| `CHECKOUT_PENDING` | `PAYMENT_FAILED` | `PAYMENT_FAILED` | webhook | — | annuncio di nuovo acquistabile |
| `CHECKOUT_PENDING` | `RESERVATION_EXPIRED` | `EXPIRED` | sweeper | PaymentIntent non riuscito | annulla il PaymentIntent; annuncio libero |
| `PAID` | `SHIPMENT_CONFIRMED` | `SHIPPED` | venditore (tracking) o webhook del vettore (presa in carico) | tracking valido | per spedizione autonoma `autoCompleteAt` = +10 giorni |
| `PAID` | `SELLER_CANCELLED`, `SHIP_DEADLINE_EXPIRED`, `MUTUAL_CANCEL` | `CANCELLED` | venditore, sweeper, accordo tra le parti | non ancora spedito | rimborso totale; annuncio di nuovo `ACTIVE` (se il venditore lo vuole); +1 cancellazione al venditore se colpa sua |
| `HANDOVER_PENDING` | `HANDOVER_CODE_VERIFIED` | `COMPLETED` | venditore inserisce il codice | codice corretto (max 5 tentativi, poi blocco di 1 ora) | trasferimento; feedback aperti |
| `HANDOVER_PENDING` | `HANDOVER_EXPIRED`, `MUTUAL_CANCEL` | `CANCELLED` | sweeper, accordo | — | rimborso totale |
| `SHIPPED` | `DELIVERED` | `DELIVERED` | webhook tracking | — | `autoCompleteAt` = consegna + 72 ore |
| `SHIPPED` | `BUYER_CONFIRMED_RECEIPT` | `COMPLETED` | acquirente con step-up | — | trasferimento |
| `SHIPPED` | `AUTO_COMPLETE_DUE` | `COMPLETED` | sweeper | solo spedizione autonoma senza evento di consegna; nessuna controversia | trasferimento |
| `SHIPPED` | `DISPUTE_OPENED` (non ricevuto) | `DISPUTED` | acquirente | dopo consegna prevista + 3 giorni, oppure 14 giorni dalla spedizione | timer sospesi |
| `DELIVERED` | `BUYER_CONFIRMED_RECEIPT`, `AUTO_COMPLETE_DUE` | `COMPLETED` | acquirente con step-up, sweeper | nessuna controversia aperta | trasferimento; ledger; feedback aperti |
| `DELIVERED` | `DISPUTE_OPENED` | `DISPUTED` | acquirente | entro 72 ore dalla consegna | timer sospesi; il venditore ha 72 ore per rispondere |
| `DISPUTED` | `RESOLVED_RELEASE` | `COMPLETED` | accordo o supporto | — | trasferimento totale |
| `DISPUTED` | `RESOLVED_PARTIAL_REFUND` | `COMPLETED` | accordo o supporto | rimborso ≤ prezzo dell'oggetto | rimborso parziale e trasferimento del resto |
| `DISPUTED` | `RETURN_REQUIRED` | `RETURN_IN_TRANSIT` | accordo o supporto | — | etichetta di reso; reso da spedire entro 5 giorni lavorativi |
| `DISPUTED` | `RESOLVED_FULL_REFUND` | `REFUNDED` | accordo o supporto | — | rimborso totale |
| `RETURN_IN_TRANSIT` | `RETURN_ACCEPTED` | `REFUNDED` | webhook tracking + 48 ore senza contestazione del venditore | — | rimborso; il venditore può ripubblicare l'annuncio |
| `RETURN_IN_TRANSIT` | `RETURN_NOT_SHIPPED` | `COMPLETED` | sweeper | reso non spedito entro il termine | trasferimento al venditore |

Valori `nextAction` usati dallo sweeper: `EXPIRE_RESERVATION`, `SHIP_REMINDER`, `SHIP_DEADLINE`, `HANDOVER_EXPIRE`, `AUTO_COMPLETE`, `DISPUTE_SELLER_DEADLINE`, `DISPUTE_BUYER_DEADLINE`, `RETURN_SHIP_DEADLINE`, `RETURN_INSPECTION_DEADLINE`. I "giorni lavorativi" escludono sabato, domenica e le festività nazionali della tabella `Holiday` (§19.5).

### 6.5 I tre flussi di consegna

```mermaid
sequenceDiagram
  autonumber
  actor A as Acquirente
  participant W as Web
  participant API as API
  participant S as Stripe
  participant SP as Provider spedizioni
  actor V as Venditore
  A->>W: Compra con pagamento protetto
  W->>API: POST /api/v1/orders con Idempotency-Key
  API->>API: blocca annuncio, calcola importi, ordine CHECKOUT_PENDING
  API->>S: crea PaymentIntent con transfer_group
  API-->>W: client secret
  W->>S: conferma pagamento (Payment Element, SCA)
  S-->>API: webhook payment_intent.succeeded
  API->>API: ordine PAID, ledger, annuncio RESERVED
  API->>SP: crea spedizione ed etichetta
  API-->>V: notifica "Hai venduto, spedisci entro 5 giorni lavorativi"
  V->>SP: consegna il pacco al punto di ritiro
  SP-->>API: webhook tracking (in transito, poi consegnato)
  API-->>A: "Consegnato: hai 72 ore per verificare"
  A->>API: conferma ricezione (step-up)
  API->>S: Transfer al venditore con source_transaction
  API->>API: ordine COMPLETED, ledger, feedback aperti
```

**Spedizione integrata** (consigliata, §7): l'etichetta la acquista la piattaforma con la quota spedizione pagata dall'acquirente. Il venditore stampa l'etichetta o mostra il QR al punto di ritiro. Gli eventi del vettore portano l'ordine a `SHIPPED` e `DELIVERED`.

**Spedizione autonoma**: il venditore spedisce con un servizio **tracciato** a sua scelta e inserisce corriere e numero di tracking (formato validato). Il numero si registra presso il `TrackingProvider` per ricevere l'evento di consegna. Senza evento di consegna, l'ordine si chiude automaticamente 10 giorni dopo la spedizione, salvo controversia. Le spedizioni non tracciate non sono ammesse con il pagamento protetto.

**Consegna a mano con codice:**
- dopo il pagamento l'acquirente vede, previo step-up, un **codice di 6 cifre** e il relativo QR. Il codice si genera con un generatore crittografico e si salva solo come HMAC-SHA256 con pepper e id ordine;
- all'incontro l'acquirente prova lo strumento e solo se è soddisfatto comunica il codice; il venditore lo inserisce in "Le mie vendite" (confronto a tempo costante, 5 tentativi, poi blocco di 1 ora) e l'ordine diventa `COMPLETED`;
- l'interfaccia lo dice chiaramente: "Comunica il codice solo dopo aver visto e provato lo strumento. Dopo l'inserimento il pagamento viene trasferito e non potrai più contestare la difformità";
- se l'incontro non avviene entro 7 giorni, o se entrambi indicano "non ci siamo incontrati", l'ordine si annulla con rimborso totale;
- guida "Consegna a mano in sicurezza": luogo pubblico o negozio, di giorno, accompagnati.

### 6.6 Controversie

- **Quando si possono aprire:**
  - *Non ricevuto*: dallo stato `SHIPPED`, dopo la data di consegna prevista + 3 giorni oppure 14 giorni dalla spedizione se non c'è una stima.
  - *Non conforme alla descrizione, danneggiato, contraffatto, incompleto, altro*: dallo stato `DELIVERED`, entro le 72 ore della finestra di verifica. Non disponibili dopo una consegna a mano con codice verificato.
- **Cosa serve:** descrizione di almeno 30 caratteri; almeno 2 foto per i casi non conforme, danneggiato, incompleto e contraffatto.
- **Procedura:**
  1. `OPEN`: il venditore ha 72 ore per accettare il rimborso totale con reso, accettare il rimborso totale senza reso, proporre un rimborso parziale oppure respingere con motivazione e prove.
  2. Se propone un rimborso parziale, la controversia va in `AWAITING_BUYER`: l'acquirente ha 72 ore per accettare o chiedere l'intervento del supporto.
  3. Escalation, su richiesta di una parte o automatica quando una scadenza non è rispettata: `UNDER_REVIEW`. Il supporto decide entro 5 giorni lavorativi e può chiedere prove aggiuntive (48 ore per fornirle).
  4. Esiti possibili: `REFUND_FULL`, `REFUND_FULL_WITH_RETURN` (l'ordine va in `RETURN_IN_TRANSIT`), `REFUND_PARTIAL` (massimo il prezzo dell'oggetto), `RELEASE_TO_SELLER`.
  5. Reso: l'acquirente spedisce entro 5 giorni lavorativi con l'etichetta di reso fornita oppure con spedizione tracciata. Dopo la consegna del reso il venditore ha 48 ore per contestarne lo stato; poi il rimborso parte in automatico.
- Ogni decisione ha una **motivazione scritta** inviata a entrambe le parti. È ammesso un ricorso interno entro 7 giorni, riesaminato da un altro membro dello staff.
- Danni da trasporto con spedizione integrata: rimborso all'acquirente; la piattaforma apre la pratica con il provider; nessuna penalità per il venditore.
- Una controversia chiusa con esito sfavorevole al venditore per sua responsabilità incrementa `disputesLost12m` (§8).

### 6.7 Annullamenti e rimborsi

Politica predefinita (da validare, configurabile, ogni scelta in un ADR):

| Caso | Rimborso all'acquirente | Commissione di protezione | Costi di spedizione già sostenuti | Effetto sul venditore |
|---|---|---|---|---|
| Annullato prima della spedizione dal venditore o per termine scaduto | totale | rimborsata | etichetta annullata se possibile, altrimenti addebitata al venditore | +1 cancellazione |
| Annullamento concordato prima della spedizione | totale | rimborsata | etichetta annullata se possibile, altrimenti a carico della piattaforma | nessuno |
| Consegna a mano non avvenuta | totale | rimborsata | — | nessuno |
| Controversia fondata per responsabilità del venditore | totale | rimborsata | spedizione e reso addebitati al venditore | controversia persa |
| Danno da trasporto con spedizione integrata | totale | rimborsata | pratica assicurativa a cura della piattaforma | nessuno |
| Rimborso parziale concordato | parziale, solo sul prezzo dell'oggetto | non rimborsata | — | nessuno |
| Controversia infondata | nessuno | — | — | nessuno |

- I rimborsi si eseguono con un Refund sul pagamento (chiave idempotente `refund:{orderId}:{n}`).
- Se il trasferimento al venditore è già avvenuto, prima si tenta lo storno del trasferimento; se non è possibile si registra un credito verso il venditore (`SELLER_RECEIVABLE`), compensato con i trasferimenti futuri; i nuovi trasferimenti restano bloccati finché il credito non è saldato.
- Gli addebiti al venditore (etichette, resi) seguono la stessa logica.

### 6.8 Chargeback (contestazioni bancarie)

- Su `charge.dispute.created`: trasferimento in `ON_HOLD` se non ancora eseguito, raccolta automatica delle prove (tracking e prova di consegna, log della chat, log della verifica del codice di consegna, esito 3DS, IP e dispositivo) e invio tramite API prima della scadenza; notifica al supporto.
- **Protezione venditore:** se il venditore ha rispettato le regole (spedizione tracciata all'indirizzo dell'ordine, oppure codice di consegna verificato), il venditore trattiene i fondi e la perdita è a carico della piattaforma (`CHARGEBACK_LOSSES`). Altrimenti si recupera dal venditore come al §6.7.

### 6.9 Ledger in partita doppia

Ogni movimento economico genera una `LedgerTransaction` con due o più `LedgerEntry`. Invarianti verificate da test e da un controllo notturno:
- in ogni transazione la somma dei DEBIT è uguale alla somma dei CREDIT;
- per ogni ordine chiuso il saldo di `SELLER_PAYABLE` relativo all'ordine è zero;
- `externalRef` univoco (per esempio `stripe:{eventId}`) impedisce doppie registrazioni.

| Evento | DEBIT | CREDIT |
|---|---|---|
| Pagamento riuscito | `CASH_STRIPE` = total | `SELLER_PAYABLE` = sellerNet; `SHIPPING_PAYABLE` = shipping (solo spedizione integrata); `PLATFORM_FEE_REVENUE` = buyerFee − IVA (+ sellerFee); `VAT_PAYABLE` = IVA |
| Commissioni Stripe | `PAYMENT_PROCESSOR_FEES` | `CASH_STRIPE` |
| Trasferimento al venditore | `SELLER_PAYABLE` = sellerNet | `CASH_STRIPE` |
| Rimborso totale prima del trasferimento | storno simmetrico delle voci del pagamento | `CASH_STRIPE` = importo rimborsato |
| Rimborso parziale | `SELLER_PAYABLE` = importo | `CASH_STRIPE` = importo |
| Addebito al venditore | `SELLER_RECEIVABLE` | conto di costo o ricavo pertinente |
| Chargeback perso con protezione venditore | `CHARGEBACK_LOSSES` | `CASH_STRIPE` |

### 6.10 Webhook e riconciliazione

- Endpoint `POST /api/v1/webhooks/stripe` con verifica della firma sul **corpo grezzo**. Salva l'evento in `WebhookEvent` (chiave `provider` + `eventId`): se esiste già risponde 200 senza rielaborarlo; altrimenti accoda l'elaborazione e risponde subito con 2xx.
- Eventi gestiti (verifica i nomi nella documentazione della versione API in uso): `payment_intent.succeeded`, `payment_intent.payment_failed`, `payment_intent.canceled`, `payment_intent.processing`; `charge.refunded` e aggiornamenti dei refund; `charge.dispute.created`, `charge.dispute.updated`, `charge.dispute.closed`; `transfer.created`, `transfer.reversed`; gli eventi di aggiornamento degli account connessi Accounts v2 (requirements e capability); i bonifici degli account connessi (`payout.paid`, `payout.failed`) per mostrare lo stato degli accrediti.
- Elaborazione idempotente con retry esponenziale; alert dopo 5 fallimenti; pannello "Log webhook" in admin con rielaborazione manuale.
- Riconciliazione notturna: confronta le *balance transaction* del giorno precedente con il ledger (associazione tramite `transfer_group` e `metadata.orderId`), mostra le differenze in admin e invia un alert.

### 6.11 Anti-frode sui pagamenti

- **Step-up obbligatorio sulla conferma di ricezione.** Una truffa diffusa consiste nel rubare le credenziali dell'acquirente con un sito clone e confermare la ricezione al suo posto per sbloccare il pagamento: la conferma richiede quindi una ri-autenticazione recente, più un codice via email se il dispositivo è nuovo.
- Radar for Platforms: regole su CVC, velocità, paese della carta; 3DS richiesto sopra 500 € o con rischio elevato.
- Account con meno di 7 giorni: massimo 3 ordini nelle 24 ore. Indirizzi di consegna solo in Italia.
- Blocco degli ordini tra account che condividono dispositivo, IP o impronta della carta (collusione); segnalazione allo staff.
- Venditori nuovi (meno di 30 giorni) con annunci sopra 2.000 €: revisione manuale prima della pubblicazione.

### 6.12 Test obbligatori dell'area pagamenti

- **Unit (packages/domain):** calcolo importi a tabella (arrotondamenti, minimo, tetto); tutte le transizioni valide e il rifiuto di quelle non ammesse; scritture del ledger bilanciate per ogni evento; calcolo dei giorni lavorativi con le festività.
- **Integrazione:** verifica firma webhook; webhook duplicato elaborato una sola volta; due acquisti concorrenti sullo stesso annuncio → un solo ordine; `POST /orders` ripetuto con la stessa `Idempotency-Key` → stessa risposta; trasferimento con `source_transaction`; rimborsi totali e parziali; chargeback (Stripe in modalità test oppure `stripe-mock`).
- **E2E** (Stripe test + `stripe listen`): carta `4242 4242 4242 4242` (successo), `4000 0027 6000 3184` (richiede 3DS), `4000 0000 0000 0002` (rifiutata); percorso completo spedizione → consegna → conferma → trasferimento → feedback; consegna a mano con codice; controversia con rimborso parziale.

---

## 7. Spedizioni e consegna a mano

### 7.1 Taglie pacco (valori segnaposto, modificabili da admin)

| Taglia | Limiti indicativi | Esempi | Prezzo all'acquirente (esempio) |
|---|---|---|---|
| S | fino a 2 kg, 40×30×10 cm | corde, pedali, microfoni, cavi | 5,90 € |
| M | fino a 5 kg, 60×40×20 cm | pedaliere, interfacce audio, cuffie, sax soprano | 7,90 € |
| L | fino a 15 kg, 120×50×20 cm | chitarre e bassi in custodia, synth a 49/61 tasti, rullanti | 12,90 € |
| XL | fino a 30 kg, 150×60×40 cm | combo, tastiere 88 tasti, casse PA piccole | 24,90 € |

- Ogni categoria ha una taglia suggerita (`Category.defaultParcelSize`); il venditore può cambiarla.
- Le categorie non spedibili (`Category.shippable = false`, es. pianoforti acustici, organi a consolle, impianti PA grandi) permettono solo la consegna a mano.
- I prezzi reali vanno presi dalle tariffe del provider (`quote()`); il prezzo mostrato è quello configurato, l'eventuale differenza va nel ledger.

### 7.2 Porte (interfacce) da implementare

```ts
// apps/api/src/modules/shipping/ports.ts
export interface ShippingProvider {
  readonly name: 'mock' | 'sendcloud' | 'shippypro';
  quote(input: QuoteInput): Promise<Quote[]>;
  createShipment(input: CreateShipmentInput): Promise<ShipmentLabel>; // etichetta PDF e/o QR + tracking
  cancelShipment(providerShipmentId: string): Promise<boolean>;
  createReturn(input: CreateReturnInput): Promise<ShipmentLabel>;
  listServicePoints(input: { cap: string; carrier?: string }): Promise<ServicePoint[]>;
  parseWebhook(headers: Record<string, string>, rawBody: Buffer): TrackingUpdate[]; // verifica la firma
}

export interface TrackingProvider {
  register(input: { carrier: string; trackingNumber: string; shipmentId: string }): Promise<void>;
  parseWebhook(headers: Record<string, string>, rawBody: Buffer): TrackingUpdate[];
}

export type TrackingUpdate = {
  shipmentId: string;
  status: 'LABEL_CREATED' | 'IN_TRANSIT' | 'OUT_FOR_DELIVERY' | 'AVAILABLE_FOR_PICKUP'
        | 'DELIVERED' | 'EXCEPTION' | 'RETURNED_TO_SENDER' | 'CANCELLED';
  occurredAt: Date;
  description?: string;
  location?: string;
};
```

### 7.3 Comportamento

- **Ordine pagato con spedizione integrata:** il worker chiama `createShipment` (mittente = indirizzo `SENDER` del venditore; destinatario = indirizzo dell'acquirente o punto di ritiro). Etichetta salvata nel bucket privato e scaricabile con URL firmato. Notifica al venditore con istruzioni.
- **Eventi di tracking** (webhook `POST /api/v1/webhooks/shipping/:provider` con verifica HMAC): aggiornano `Shipment.status` ed `events`. La prima presa in carico genera `SHIPMENT_CONFIRMED`; `DELIVERED` genera l'evento omonimo sull'ordine; `EXCEPTION` notifica entrambe le parti e, se dura più di 5 giorni, apre un ticket al supporto; `RETURNED_TO_SENDER` apre una verifica del supporto.
- **Promemoria al venditore** 24 ore prima della scadenza di spedizione; alla scadenza annullamento automatico con rimborso (§6.4).
- **Adapter finto (`mock`)** per sviluppo ed e2e: genera un PDF segnaposto e un tracking `MOCK-…`; endpoint disponibile solo in sviluppo `POST /api/v1/dev/shipments/:id/advance` per simulare gli eventi successivi.
- **Adapter reale:** Sendcloud **oppure** ShippyPro in sandbox, scelto con `SHIPPING_PROVIDER`. Implementane uno solo nell'MVP; l'altro resta possibile grazie alla porta.
- **Contenuti:** guida "Come imballare uno strumento" (chitarre: allentare le corde, proteggere la paletta, custodia rigida più scatola; tastiere: imballo originale o doppio cartone; amplificatori valvolari: togliere le valvole se possibile). Mostra il link nella notifica "Hai venduto".

---

## 8. Feedback e reputazione

Modello ispirato a eBay e adattato al mondo degli strumenti. Logica di calcolo pura in `packages/domain/reputation`, con test.

### 8.1 Chi può lasciare un feedback e quando

- Solo le parti di un ordine **`COMPLETED`** pagato sulla piattaforma (spedizione o consegna a mano con codice). Nessun feedback per accordi presi fuori piattaforma: è anche un incentivo a usare il pagamento protetto.
- Un feedback per ruolo per ordine (`@@unique([orderId, role])`).
- Finestra di **60 giorni** dal completamento; promemoria al giorno 3 e al giorno 30.
- Prima di un neutro o di un negativo l'interfaccia chiede: "Hai provato a risolvere con il venditore?" e offre di aprire la chat (senza obbligare).

### 8.2 Contenuto

- **Acquirente → venditore:** giudizio complessivo Positivo / Neutro / Negativo; commento (obbligatorio per neutro e negativo, 20–500 caratteri; facoltativo per il positivo, massimo 500); **valutazioni dettagliate** da 1 a 5 stelle su quattro criteri:
  1. Oggetto conforme alla descrizione
  2. Comunicazione
  3. Tempi di spedizione (non richiesto per consegna a mano)
  4. Imballaggio (non richiesto per consegna a mano)

  Il quarto criterio di eBay (costi di spedizione) qui è sostituito da "Imballaggio", più significativo per gli strumenti, perché con la spedizione integrata i costi li fissa la piattaforma.
- **Venditore → acquirente:** **solo positivo**, con commento facoltativo. I problemi con un acquirente si segnalano in privato allo staff e influiscono sul punteggio di rischio interno, non sul profilo pubblico. Vincolo anche a livello di database (§10.2).

### 8.3 Risposte e revisioni

- Il destinatario può pubblicare **una risposta** (massimo 500 caratteri) a ciascun feedback ricevuto.
- **Richiesta di revisione** (il venditore chiede all'acquirente di rivedere un neutro o un negativo), con le regole di eBay:
  - solo per feedback ricevuti da meno di 30 giorni;
  - una sola richiesta per ordine;
  - al massimo 5 richieste per anno solare, più 5 ogni 1.000 feedback ricevuti negli ultimi 12 mesi;
  - l'acquirente ha 10 giorni per accettare (e allora modifica giudizio e commento) o rifiutare; poi la richiesta scade;
  - la revisione può solo migliorare il giudizio. Il valore precedente resta salvato (`previousRating`, `previousComment`).
- **Estorsione di feedback vietata:** non si può minacciare un negativo per ottenere rimborsi o sconti, né offrire vantaggi in cambio di un positivo. C'è un pulsante "Segnala estorsione".

### 8.4 Calcoli

Definizioni (parametri in `PlatformSetting`):
- **Feedback conteggiabile:** stato `PUBLISHED`; ordine con prezzo dell'oggetto ≥ `FEEDBACK_MIN_ORDER_CENTS` (default 300 = 3 €, contro il "farming" di feedback); il primo feedback del gruppo (autore, destinatario, ruolo, settimana ISO del completamento dell'ordine). I feedback successivi dello stesso gruppo restano visibili ma non contano (`countsTowardScore = false`, `weekKey` = es. `2026-W44`).
- **Punteggio** (a vita): +1 per ogni positivo conteggiabile, 0 per i neutri, −1 per ogni negativo conteggiabile. Somma dei feedback ricevuti come venditore e come acquirente.
- **Percentuale di positivi come venditore** (ultimi 12 mesi): positivi / (positivi + negativi) tra i feedback conteggiabili ricevuti come venditore negli ultimi 365 giorni; i neutri sono esclusi. Mostrata con un decimale (es. 99,4%). Senza feedback: "Nessun feedback".
- **Valutazioni dettagliate:** media degli ultimi 12 mesi per criterio, mostrata solo con almeno 5 valutazioni per quel criterio.
- I feedback rimossi non contano in nessun calcolo; un feedback rivisto conta con il nuovo giudizio.
- Aggiornamento: ricalcolo incrementale sugli eventi (`feedback.created`, `feedback.revised`, `feedback.removed`, `order.completed`) più ricalcolo completo ogni notte. Risultati in `UserReputation`.

### 8.5 Livelli (icone a forma di nota, colori diversi; niente emoji)

| Punteggio | Livello |
|---|---|
| 10–49 | Esordiente |
| 50–99 | Turnista |
| 100–499 | Solista |
| 500–999 | Professionista |
| 1.000–4.999 | Maestro |
| 5.000+ | Leggenda |

### 8.6 Badge "Venditore Top"

Ricalcolato ogni notte sugli ultimi 12 mesi. Requisiti (configurabili):
- account con almeno 90 giorni e identità verificata (`transfersEnabled = true`);
- almeno 20 vendite completate e almeno 1.000 € di volume;
- percentuale di positivi ≥ 98%;
- media delle valutazioni dettagliate ≥ 4,7 (con almeno 10 valutazioni);
- controversie perse ≤ 1% delle vendite (oppure al massimo 1 se le vendite sono meno di 100);
- cancellazioni imputabili al venditore ≤ 2%;
- nessuna sanzione attiva.

### 8.7 Altri indicatori di fiducia sul profilo

- **Tempo di risposta:** mediana dei minuti tra il primo messaggio di un acquirente e la prima risposta del venditore (ultimi 30 giorni). Mostrato come "Risponde di solito entro un'ora / entro qualche ora / in giornata".
- **Tasso di risposta:** percentuale di conversazioni avviate da acquirenti negli ultimi 30 giorni con risposta entro 24 ore.
- Vendite e acquisti completati, membro dal, identità verificata, email verificata, negozio verificato.

### 8.8 Moderazione e anti-manipolazione

- **Controlli automatici prima della pubblicazione:** contatti, link, IBAN, dati personali, insulti (lista di parole configurabile). Se scattano, il feedback va in `HIDDEN` in attesa di revisione.
- **Motivi di rimozione** (codici): `OFFENSIVE`, `PERSONAL_DATA`, `CONTACT_OR_LINKS`, `EXTORTION`, `UNRELATED`, `ILLEGAL`, `AUTHOR_BANNED_FOR_FRAUD`, `DISPUTE_ABUSE`. Ogni rimozione crea una `ModerationAction` con motivazione e notifica entrambe le parti.
- **Segnali di manipolazione:** coppie di utenti con più di 3 ordini reciproci in 30 giorni; account che condividono dispositivo, IP o impronta della carta (in questo caso i feedback non contano e l'account va in revisione); molti ordini di importo minimo.
- **Pagina informativa** "Come funzionano i feedback": spiega che li lasciano solo utenti che hanno concluso un ordine pagato sulla piattaforma, come si calcolano e come si moderano (obbligo informativo sulle recensioni, §14).

### 8.9 Visualizzazione

- **Card e pagina annuncio:** nome utente, icona del livello, "99,4% positivi (238)", badge Venditore Top.
- **Pagina feedback del profilo** `/utente/[username]/feedback`: tabella riassuntiva a 1, 6 e 12 mesi (positivi, neutri, negativi); barre delle valutazioni dettagliate con media e numero; elenco filtrabile (ricevuti come venditore, ricevuti come acquirente, lasciati). Ogni voce mostra giudizio, commento, autore con nome mascherato (es. `m***o`) e il suo punteggio, titolo dell'oggetto, data, etichetta "Acquisto verificato", eventuale risposta.
- **"Il mio account → Feedback":** da lasciare, ricevuti, lasciati, richieste di revisione.

### 8.10 Test obbligatori

Deduplicazione per settimana; finestra di 12 mesi; esclusione dei neutri dalla percentuale; soglia di importo minimo; feedback rivisto e rimosso; vincolo "venditore solo positivo"; finestra di 60 giorni; quote delle richieste di revisione; livelli; requisiti Venditore Top; valutazioni assenti per la consegna a mano.

---

## 9. Ricerca

### 9.1 Indice `listings` su Meilisearch

Solo annunci `ACTIVE` e `RESERVED` (questi ultimi con etichetta "In trattativa"). Documento:

```json
{
  "id": "uuid", "shortId": "8K2F9Q1M", "slug": "fender-stratocaster-player-2021",
  "title": "…", "description": "…(max 2.000 caratteri)",
  "brand": "Fender", "brandSlug": "fender", "model": "Player Stratocaster",
  "departmentSlug": "chitarre", "categorySlug": "chitarre-elettriche", "categoryName": "Chitarre elettriche",
  "condition": "EXCELLENT", "year": 2021, "priceCents": 65000, "isNegotiable": true,
  "sellerType": "PRIVATE", "sellerId": "uuid", "sellerUsername": "…", "sellerPositivePctBps": 9940,
  "sellerScore": 238, "isTopSeller": false,
  "protectedPayment": true, "shippingAvailable": true, "handDelivery": true,
  "regioneSlug": "lombardia", "provinciaSigla": "MI", "comuneId": "015146", "comuneName": "Milano",
  "_geo": { "lat": 45.4642, "lng": 9.19 },
  "attr": { "pickupConfig": "HSS", "leftHanded": false },
  "imageUrl": "https://media…/640.webp", "imagesCount": 8,
  "status": "ACTIVE", "publishedAt": 1793000000, "bumpedAt": 1793000000
}
```

### 9.2 Impostazioni

- `searchableAttributes` (in ordine di importanza): `title`, `brand`, `model`, `categoryName`, `description`.
- `filterableAttributes`: `departmentSlug`, `categorySlug`, `brandSlug`, `condition`, `priceCents`, `sellerType`, `protectedPayment`, `shippingAvailable`, `handDelivery`, `regioneSlug`, `provinciaSigla`, `comuneId`, `year`, `isTopSeller`, `status`, `sellerId`, `_geo`, `attr` (gli attributi annidati si filtrano con la notazione a punto, es. `attr.keys = 88`).
- `sortableAttributes`: `priceCents`, `publishedAt`, `bumpedAt`, `_geo`.
- `rankingRules`: quelle predefinite più `bumpedAt:desc` in coda (a parità di pertinenza vince l'annuncio più recente).
- Tolleranza agli errori attiva (es. "stratocster" deve trovare "Stratocaster"); `stopWords` italiane; `faceting.maxValuesPerFacet = 100`; `pagination.maxTotalHits = 10000`.
- **Sinonimi** di settore: strato ↔ stratocaster; tele ↔ telecaster; lp ↔ les paul; ampli ↔ amplificatore; synth ↔ sintetizzatore; testata ↔ head; cassa ↔ cabinet; sax ↔ sassofono; scheda audio ↔ interfaccia audio; batteria elettronica ↔ e-drum; giradischi ↔ turntable; valvolare ↔ valvole ↔ tube; cuffie ↔ headphones; piano digitale ↔ pianoforte digitale; consolle ↔ console. Elenco modificabile da admin.

### 9.3 API e comportamento

- `GET /api/v1/search/listings` traduce i parametri (§11) nei filtri Meilisearch e restituisce risultati e faccette con conteggi. Senza testo l'ordinamento predefinito è "più recenti" (`bumpedAt:desc`).
- **Ricerca per distanza:** coordinate dal centroide del comune scelto dall'utente; `_geoRadius(lat, lng, km × 1000)` e ordinamento `_geoPoint(lat, lng):asc`.
- **Autocompletamento:** `multiSearch` su indici leggeri `brands` e `categories` più i titoli degli annunci (massimo 8 suggerimenti).
- **Sincronizzazione** via outbox (`listing.*` → coda `search-index`). Reindicizzazione completa con `pnpm search:reindex` su un indice nuovo e scambio atomico degli indici (*index swap*), senza interruzioni.
- **Modalità degradata:** se Meilisearch non risponde, l'API ripiega su PostgreSQL (`pg_trgm` sul titolo + filtri base) e il web mostra un avviso discreto.
- **Avvisi delle ricerche salvate:** ogni 10 minuti, per le ricerche "istantanee", si riesegue la query con `publishedAt > lastNotifiedAt`; alle 8:00 il riepilogo giornaliero. Documenta in un ADR la strada per scalare (ricerca inversa o "percolazione") quando le ricerche salvate diventano molte.
- **SEO delle faccette:** solo le combinazioni previste (reparto, categoria, categoria + marca, marca) sono indicizzabili e con URL canonico; le altre combinazioni di filtri hanno `noindex, follow`. Una pagina di atterraggio con meno di 3 risultati è `noindex`.

---

## 10. Modello dati

### 10.1 Schema Prisma completo

File `packages/db/prisma/schema.prisma`. Lo schema è stato validato con il validatore di Prisma 7.10. Note:
- Prisma 7: l'URL del database **non** va nello schema ma in `packages/db/prisma.config.ts` (con `datasource.url`, percorso delle migrazioni e comando di seed). A runtime il client si crea con il driver adapter `@prisma/adapter-pg`.
- I modelli `User`, `Session`, `Account`, `Verification`, `TwoFactor` e `Passkey` seguono il formato di Better Auth (plugin admin, username, twoFactor, passkey, phoneNumber). Allineali con `npx @better-auth/cli generate` per la versione installata e registra le differenze in un ADR.
- Id UUIDv7 generati dal database; date in UTC; importi in centesimi.
- I riferimenti a chi ha compiuto un'azione nei log (`actorId`, `moderatorId`, `resolvedById`…) sono stringhe senza relazione, così i log sopravvivono all'anonimizzazione degli utenti.

```prisma
generator client {
  provider = "prisma-client"
  output   = "../src/generated/prisma"
}

datasource db {
  provider = "postgresql"
}

// ───────────────────────────── ENUM ─────────────────────────────

enum AccountType {
  PRIVATE
  BUSINESS
}

enum UserStatus {
  ACTIVE
  LIMITED
  SUSPENDED
  BANNED
  DELETED
}

enum ListingType {
  SELL
  WANTED
}

enum ListingStatus {
  DRAFT
  PENDING_REVIEW
  ACTIVE
  PAUSED
  RESERVED
  SOLD
  EXPIRED
  REJECTED
  REMOVED
}

enum ItemCondition {
  NEW
  LIKE_NEW
  EXCELLENT
  GOOD
  FAIR
  FOR_PARTS
}

enum AttributeType {
  TEXT
  NUMBER
  BOOLEAN
  ENUM
  MULTI_ENUM
}

enum ParcelSize {
  S
  M
  L
  XL
}

enum AddressType {
  SHIPPING
  SENDER
}

enum AlertFrequency {
  NONE
  INSTANT
  DAILY
}

enum MessageType {
  TEXT
  IMAGE
  OFFER
  SYSTEM
}

enum OfferStatus {
  PENDING
  ACCEPTED
  DECLINED
  COUNTERED
  EXPIRED
  WITHDRAWN
  CONSUMED
}

enum DeliveryMethod {
  SHIPPING_INTEGRATED
  SHIPPING_SELF
  HAND_DELIVERY
}

enum OrderStatus {
  CHECKOUT_PENDING
  PAYMENT_FAILED
  EXPIRED
  PAID
  HANDOVER_PENDING
  SHIPPED
  DELIVERED
  DISPUTED
  RETURN_IN_TRANSIT
  COMPLETED
  REFUNDED
  CANCELLED
}

enum PayoutStatus {
  NOT_DUE
  ON_HOLD
  SCHEDULED
  TRANSFERRED
  REVERSED
  FAILED
}

enum ShipmentDirection {
  OUTBOUND
  RETURN
}

enum ShipmentStatus {
  PENDING
  LABEL_CREATED
  IN_TRANSIT
  OUT_FOR_DELIVERY
  AVAILABLE_FOR_PICKUP
  DELIVERED
  EXCEPTION
  RETURNED_TO_SENDER
  CANCELLED
}

enum RefundStatus {
  PENDING
  SUCCEEDED
  FAILED
}

enum DisputeReason {
  NOT_RECEIVED
  NOT_AS_DESCRIBED
  DAMAGED
  COUNTERFEIT
  INCOMPLETE
  OTHER
}

enum DisputeStatus {
  OPEN
  AWAITING_BUYER
  UNDER_REVIEW
  AWAITING_RETURN
  RESOLVED
  WITHDRAWN
}

enum DisputeOutcome {
  REFUND_FULL
  REFUND_FULL_WITH_RETURN
  REFUND_PARTIAL
  RELEASE_TO_SELLER
}

enum PartyRole {
  BUYER
  SELLER
  SUPPORT
  SYSTEM
}

enum FeedbackRole {
  BUYER_TO_SELLER
  SELLER_TO_BUYER
}

enum FeedbackRating {
  POSITIVE
  NEUTRAL
  NEGATIVE
}

enum FeedbackStatus {
  PUBLISHED
  HIDDEN
  REMOVED
}

enum RevisionRequestStatus {
  PENDING
  ACCEPTED
  DECLINED
  EXPIRED
}

enum ReportTargetType {
  LISTING
  USER
  MESSAGE
  FEEDBACK
  SHOP
}

enum ReportStatus {
  OPEN
  IN_REVIEW
  ACTION_TAKEN
  DISMISSED
}

enum ModerationActionType {
  LISTING_REJECTED
  LISTING_REMOVED
  LISTING_RESTORED
  USER_WARNED
  USER_LIMITED
  USER_SUSPENDED
  USER_BANNED
  USER_REINSTATED
  FEEDBACK_REMOVED
  MESSAGE_HIDDEN
}

enum LedgerAccount {
  CASH_STRIPE
  SELLER_PAYABLE
  SHIPPING_PAYABLE
  PLATFORM_FEE_REVENUE
  VAT_PAYABLE
  PAYMENT_PROCESSOR_FEES
  CHARGEBACK_LOSSES
  SELLER_RECEIVABLE
}

enum LedgerDirection {
  DEBIT
  CREDIT
}

enum NotificationChannel {
  IN_APP
  EMAIL
  PUSH
}

enum OutboxStatus {
  PENDING
  PROCESSED
  FAILED
}

// ─────────────────── AUTENTICAZIONE (Better Auth) ───────────────────

model User {
  id                  String    @id @default(uuid(7))
  name                String
  email               String    @unique
  emailVerified       Boolean   @default(false)
  image               String?
  createdAt           DateTime  @default(now())
  updatedAt           DateTime  @updatedAt
  username            String?   @unique
  displayUsername     String?
  phoneNumber         String?   @unique
  phoneNumberVerified Boolean   @default(false)
  twoFactorEnabled    Boolean   @default(false)
  role                String    @default("user")
  banned              Boolean   @default(false)
  banReason           String?
  banExpires          DateTime?

  accountType        AccountType @default(PRIVATE)
  status             UserStatus  @default(ACTIVE)
  bio                String?     @db.VarChar(1000)
  comuneId           String?
  locale             String      @default("it-IT")
  lastSeenAt         DateTime?
  termsAcceptedAt    DateTime?
  marketingConsentAt DateTime?
  deletedAt          DateTime?

  comune                Comune?                  @relation(fields: [comuneId], references: [id])
  sessions              Session[]
  accounts              Account[]
  twoFactors            TwoFactor[]
  passkeys              Passkey[]
  shop                  Shop?
  addresses             Address[]
  listings              Listing[]
  favorites             Favorite[]
  savedSearches         SavedSearch[]
  recentlyViewed        RecentlyViewed[]
  following             Follow[]                 @relation("Follower")
  followers             Follow[]                 @relation("Followed")
  blocking              UserBlock[]              @relation("Blocker")
  blockedBy             UserBlock[]              @relation("Blocked")
  conversationsAsBuyer  Conversation[]           @relation("ConversationBuyer")
  conversationsAsSeller Conversation[]           @relation("ConversationSeller")
  messages              Message[]
  offersMade            Offer[]                  @relation("OfferBuyer")
  offersReceived        Offer[]                  @relation("OfferSeller")
  purchases             Order[]                  @relation("OrderBuyer")
  sales                 Order[]                  @relation("OrderSeller")
  paymentAccount        PaymentAccount?
  feedbackGiven         Feedback[]               @relation("FeedbackAuthor")
  feedbackReceived      Feedback[]               @relation("FeedbackRecipient")
  reputation            UserReputation?
  notifications         Notification[]
  notificationPrefs     NotificationPreference[]
  pushSubscriptions     PushSubscription[]
  taxProfile            TaxProfile?
  dac7Periods           Dac7Period[]
  knownDevices          KnownDevice[]

  @@index([status])
}

model Session {
  id             String   @id @default(uuid(7))
  expiresAt      DateTime
  token          String   @unique
  createdAt      DateTime @default(now())
  updatedAt      DateTime @updatedAt
  ipAddress      String?
  userAgent      String?
  userId         String
  impersonatedBy String?
  user           User     @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@index([userId])
}

model Account {
  id                    String    @id @default(uuid(7))
  accountId             String
  providerId            String
  userId                String
  accessToken           String?
  refreshToken          String?
  idToken               String?
  accessTokenExpiresAt  DateTime?
  refreshTokenExpiresAt DateTime?
  scope                 String?
  password              String?
  createdAt             DateTime  @default(now())
  updatedAt             DateTime  @updatedAt
  user                  User      @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@index([userId])
}

model Verification {
  id         String   @id @default(uuid(7))
  identifier String
  value      String
  expiresAt  DateTime
  createdAt  DateTime @default(now())
  updatedAt  DateTime @updatedAt

  @@index([identifier])
}

model TwoFactor {
  id          String @id @default(uuid(7))
  secret      String
  backupCodes String
  userId      String
  user        User   @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@index([userId])
}

model Passkey {
  id           String    @id @default(uuid(7))
  name         String?
  publicKey    String
  userId       String
  credentialID String    @unique
  counter      Int
  deviceType   String
  backedUp     Boolean
  transports   String?
  aaguid       String?
  createdAt    DateTime? @default(now())
  user         User      @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@index([userId])
}

// Dispositivi riconosciuti (cookie firmato a lunga durata) per step-up e avvisi di nuovo accesso
model KnownDevice {
  id           String   @id @default(uuid(7))
  userId       String
  deviceIdHash String
  userAgent    String?
  ipPrefix     String?
  firstSeenAt  DateTime @default(now())
  lastSeenAt   DateTime @default(now())
  user         User     @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@unique([userId, deviceIdHash])
}

// ─────────────────────────── GEOGRAFIA ───────────────────────────

model Regione {
  id       String      @id // codice ISTAT
  name     String
  slug     String      @unique
  province Provincia[]
}

model Provincia {
  id        String   @id // codice ISTAT dell'unità territoriale sovracomunale
  sigla     String   @unique
  name      String
  slug      String   @unique
  regioneId String
  regione   Regione  @relation(fields: [regioneId], references: [id])
  comuni    Comune[]

  @@index([regioneId])
}

model Comune {
  id              String    @id // codice ISTAT del comune
  name            String
  slug            String
  provinciaId     String
  codiceCatastale String?   @unique
  caps            String[]
  lat             Float?
  lng             Float?
  provincia       Provincia @relation(fields: [provinciaId], references: [id])
  users           User[]
  shops           Shop[]
  addresses       Address[]
  listings        Listing[]

  @@unique([provinciaId, slug])
  @@index([name])
}

// ─────────────────────────── CATALOGO ───────────────────────────

model Department {
  id         String     @id @default(uuid(7))
  slug       String     @unique
  name       String
  position   Int        @default(0)
  icon       String?
  categories Category[]
}

model Category {
  id                String              @id @default(uuid(7))
  departmentId      String
  parentId          String?
  slug              String
  name              String
  position          Int                 @default(0)
  isActive          Boolean             @default(true)
  shippable         Boolean             @default(true)
  defaultParcelSize ParcelSize?
  department        Department          @relation(fields: [departmentId], references: [id])
  parent            Category?           @relation("CategoryTree", fields: [parentId], references: [id])
  children          Category[]          @relation("CategoryTree")
  attributes        CategoryAttribute[]
  listings          Listing[]

  @@unique([departmentId, slug])
  @@index([parentId])
}

model AttributeDefinition {
  id           String              @id @default(uuid(7))
  key          String              @unique
  label        String
  type         AttributeType
  unit         String?
  options      Json?
  isFilterable Boolean             @default(false)
  categories   CategoryAttribute[]
}

model CategoryAttribute {
  categoryId  String
  attributeId String
  required    Boolean             @default(false)
  position    Int                 @default(0)
  category    Category            @relation(fields: [categoryId], references: [id], onDelete: Cascade)
  attribute   AttributeDefinition @relation(fields: [attributeId], references: [id], onDelete: Cascade)

  @@id([categoryId, attributeId])
}

model Brand {
  id         String    @id @default(uuid(7))
  name       String    @unique
  slug       String    @unique
  aliases    String[]
  isVerified Boolean   @default(true)
  listings   Listing[]
}

// ─────────────────────── NEGOZI E INDIRIZZI ───────────────────────

model Shop {
  id                    String    @id @default(uuid(7))
  ownerId               String    @unique
  slug                  String    @unique
  name                  String
  legalName             String
  vatNumber             String    @unique
  taxCode               String?
  reaNumber             String?
  pec                   String?
  sdiCode               String?
  email                 String
  phone                 String
  website               String?
  addressLine           String
  cap                   String
  comuneId              String
  description           String?   @db.Text
  returnPolicy          String?   @db.Text
  warrantyInfo          String?   @db.Text
  logoKey               String?
  coverKey              String?
  openingHours          Json?
  traderSelfCertifiedAt DateTime?
  isVerified            Boolean   @default(false)
  verifiedAt            DateTime?
  createdAt             DateTime  @default(now())
  updatedAt             DateTime  @updatedAt
  owner                 User      @relation(fields: [ownerId], references: [id])
  comune                Comune    @relation(fields: [comuneId], references: [id])
  listings              Listing[]
}

model Address {
  id        String      @id @default(uuid(7))
  userId    String
  type      AddressType @default(SHIPPING)
  fullName  String
  line1     String
  line2     String?
  cap       String
  comuneId  String
  phone     String
  isDefault Boolean     @default(false)
  createdAt DateTime    @default(now())
  updatedAt DateTime    @updatedAt
  user      User        @relation(fields: [userId], references: [id], onDelete: Cascade)
  comune    Comune      @relation(fields: [comuneId], references: [id])

  @@index([userId])
}

// ─────────────────────────── ANNUNCI ───────────────────────────

model Listing {
  id                      String                @id @default(uuid(7))
  shortId                 String                @unique
  slug                    String
  sellerId                String
  shopId                  String?
  type                    ListingType           @default(SELL)
  status                  ListingStatus         @default(DRAFT)
  categoryId              String
  brandId                 String?
  modelName               String?               @db.VarChar(120)
  title                   String                @db.VarChar(120)
  description             String                @db.Text
  condition               ItemCondition
  year                    Int?
  attributes              Json                  @default("{}")
  priceCents              Int
  currency                String                @default("EUR") @db.Char(3)
  isNegotiable            Boolean               @default(false)
  acceptsTrades           Boolean               @default(false)
  comuneId                String
  lat                     Float?
  lng                     Float?
  protectedPaymentEnabled Boolean               @default(false)
  shippingIntegrated      Boolean               @default(false)
  parcelSize              ParcelSize?
  shippingSelf            Boolean               @default(false)
  selfShippingPriceCents  Int?
  handDeliveryEnabled     Boolean               @default(true)
  serialNumberHash        String?
  viewsCount              Int                   @default(0)
  favoritesCount          Int                   @default(0)
  publishedAt             DateTime?
  expiresAt               DateTime?
  bumpedAt                DateTime?
  soldAt                  DateTime?
  rejectionReason         String?
  createdAt               DateTime              @default(now())
  updatedAt               DateTime              @updatedAt
  deletedAt               DateTime?
  seller                  User                  @relation(fields: [sellerId], references: [id])
  shop                    Shop?                 @relation(fields: [shopId], references: [id])
  category                Category              @relation(fields: [categoryId], references: [id])
  brand                   Brand?                @relation(fields: [brandId], references: [id])
  comune                  Comune                @relation(fields: [comuneId], references: [id])
  images                  ListingImage[]
  priceHistory            ListingPriceHistory[]
  favorites               Favorite[]
  recentlyViewed          RecentlyViewed[]
  conversations           Conversation[]
  offers                  Offer[]
  orders                  Order[]

  @@index([status, publishedAt])
  @@index([sellerId, status])
  @@index([categoryId, status])
  @@index([brandId])
}

model ListingImage {
  id          String   @id @default(uuid(7))
  listingId   String
  storageKey  String
  width       Int
  height      Int
  position    Int      @default(0)
  altText     String?
  blurDataUrl String?
  phash       String?
  createdAt   DateTime @default(now())
  listing     Listing  @relation(fields: [listingId], references: [id], onDelete: Cascade)

  @@index([listingId, position])
  @@index([phash])
}

model ListingPriceHistory {
  id         String   @id @default(uuid(7))
  listingId  String
  priceCents Int
  changedAt  DateTime @default(now())
  listing    Listing  @relation(fields: [listingId], references: [id], onDelete: Cascade)

  @@index([listingId, changedAt])
}

model Favorite {
  userId    String
  listingId String
  createdAt DateTime @default(now())
  user      User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  listing   Listing  @relation(fields: [listingId], references: [id], onDelete: Cascade)

  @@id([userId, listingId])
  @@index([listingId])
}

model SavedSearch {
  id             String         @id @default(uuid(7))
  userId         String
  name           String
  query          Json
  alertFrequency AlertFrequency @default(DAILY)
  lastNotifiedAt DateTime?
  createdAt      DateTime       @default(now())
  user           User           @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@index([userId])
  @@index([alertFrequency])
}

model RecentlyViewed {
  userId    String
  listingId String
  viewedAt  DateTime @default(now())
  user      User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  listing   Listing  @relation(fields: [listingId], references: [id], onDelete: Cascade)

  @@id([userId, listingId])
  @@index([userId, viewedAt])
}

model Follow {
  followerId String
  followedId String
  createdAt  DateTime @default(now())
  follower   User     @relation("Follower", fields: [followerId], references: [id], onDelete: Cascade)
  followed   User     @relation("Followed", fields: [followedId], references: [id], onDelete: Cascade)

  @@id([followerId, followedId])
  @@index([followedId])
}

model UserBlock {
  blockerId String
  blockedId String
  createdAt DateTime @default(now())
  blocker   User     @relation("Blocker", fields: [blockerId], references: [id], onDelete: Cascade)
  blocked   User     @relation("Blocked", fields: [blockedId], references: [id], onDelete: Cascade)

  @@id([blockerId, blockedId])
}

// ─────────────────────── MESSAGGI E OFFERTE ───────────────────────

model Conversation {
  id               String    @id @default(uuid(7))
  listingId        String
  buyerId          String
  sellerId         String
  lastMessageAt    DateTime  @default(now())
  buyerUnread      Int       @default(0)
  sellerUnread     Int       @default(0)
  buyerArchivedAt  DateTime?
  sellerArchivedAt DateTime?
  createdAt        DateTime  @default(now())
  listing          Listing   @relation(fields: [listingId], references: [id])
  buyer            User      @relation("ConversationBuyer", fields: [buyerId], references: [id])
  seller           User      @relation("ConversationSeller", fields: [sellerId], references: [id])
  messages         Message[]

  @@unique([listingId, buyerId])
  @@index([buyerId, lastMessageAt])
  @@index([sellerId, lastMessageAt])
}

model Message {
  id             String       @id @default(uuid(7))
  conversationId String
  senderId       String?
  type           MessageType  @default(TEXT)
  body           String?      @db.Text
  attachments    Json?
  offerId        String?
  flags          String[]
  isHidden       Boolean      @default(false)
  readAt         DateTime?
  createdAt      DateTime     @default(now())
  conversation   Conversation @relation(fields: [conversationId], references: [id], onDelete: Cascade)
  sender         User?        @relation(fields: [senderId], references: [id])
  offer          Offer?       @relation(fields: [offerId], references: [id])

  @@index([conversationId, createdAt])
}

model Offer {
  id            String      @id @default(uuid(7))
  listingId     String
  buyerId       String
  sellerId      String
  amountCents   Int
  status        OfferStatus @default(PENDING)
  parentOfferId String?
  expiresAt     DateTime
  respondedAt   DateTime?
  createdAt     DateTime    @default(now())
  listing       Listing     @relation(fields: [listingId], references: [id])
  buyer         User        @relation("OfferBuyer", fields: [buyerId], references: [id])
  seller        User        @relation("OfferSeller", fields: [sellerId], references: [id])
  parentOffer   Offer?      @relation("OfferThread", fields: [parentOfferId], references: [id])
  counterOffers Offer[]     @relation("OfferThread")
  messages      Message[]
  order         Order?

  @@index([listingId, status])
  @@index([buyerId, status])
}

// ─────────────────────── ORDINI E PAGAMENTI ───────────────────────

model Order {
  id                 String              @id @default(uuid(7))
  number             String              @unique
  listingId          String
  buyerId            String
  sellerId           String
  offerId            String?             @unique
  status             OrderStatus         @default(CHECKOUT_PENDING)
  deliveryMethod     DeliveryMethod
  version            Int                 @default(0)
  listingSnapshot    Json
  itemPriceCents     Int
  shippingPriceCents Int                 @default(0)
  buyerFeeCents      Int
  buyerFeeVatCents   Int                 @default(0)
  sellerFeeCents     Int                 @default(0)
  totalCents         Int
  sellerNetCents     Int
  refundedCents      Int                 @default(0)
  currency           String              @default("EUR") @db.Char(3)
  shippingAddress    Json?
  servicePoint       Json?
  handoverCodeHash   String?
  handoverAttempts   Int                 @default(0)
  handoverLockedTill DateTime?
  paymentProvider    String              @default("stripe")
  paymentIntentId    String?             @unique
  chargeId           String?             @unique
  transferGroup      String              @unique
  payoutStatus       PayoutStatus        @default(NOT_DUE)
  transferId         String?             @unique
  transferredAt      DateTime?
  nextAction         String?
  nextActionAt       DateTime?
  reservedUntil      DateTime?
  shipBy             DateTime?
  autoCompleteAt     DateTime?
  paidAt             DateTime?
  shippedAt          DateTime?
  deliveredAt        DateTime?
  completedAt        DateTime?
  cancelledAt        DateTime?
  refundedAt         DateTime?
  cancelReason       String?
  createdAt          DateTime            @default(now())
  updatedAt          DateTime            @updatedAt
  listing            Listing             @relation(fields: [listingId], references: [id])
  buyer              User                @relation("OrderBuyer", fields: [buyerId], references: [id])
  seller             User                @relation("OrderSeller", fields: [sellerId], references: [id])
  offer              Offer?              @relation(fields: [offerId], references: [id])
  events             OrderEvent[]
  shipments          Shipment[]
  refunds            Refund[]
  dispute            Dispute?
  paymentDisputes    PaymentDispute[]
  feedback           Feedback[]
  ledgerTransactions LedgerTransaction[]

  @@index([buyerId, status])
  @@index([sellerId, status])
  @@index([listingId])
  @@index([nextActionAt])
}

model OrderEvent {
  id         String       @id @default(uuid(7))
  orderId    String
  fromStatus OrderStatus?
  toStatus   OrderStatus
  event      String
  actorRole  PartyRole
  actorId    String?
  reason     String?
  metadata   Json?
  createdAt  DateTime     @default(now())
  order      Order        @relation(fields: [orderId], references: [id], onDelete: Cascade)

  @@index([orderId, createdAt])
}

model Shipment {
  id                  String            @id @default(uuid(7))
  orderId             String
  direction           ShipmentDirection @default(OUTBOUND)
  provider            String
  carrier             String?
  service             String?
  trackingNumber      String?
  trackingUrl         String?
  labelKey            String?
  providerShipmentId  String?           @unique
  parcelSize          ParcelSize?
  status              ShipmentStatus    @default(PENDING)
  events              Json              @default("[]")
  estimatedDeliveryAt DateTime?
  shippedAt           DateTime?
  deliveredAt         DateTime?
  createdAt           DateTime          @default(now())
  updatedAt           DateTime          @updatedAt
  order               Order             @relation(fields: [orderId], references: [id])

  @@index([orderId])
  @@index([trackingNumber])
}

model Refund {
  id               String       @id @default(uuid(7))
  orderId          String
  amountCents      Int
  reason           String
  includesBuyerFee Boolean      @default(true)
  providerRefundId String?      @unique
  status           RefundStatus @default(PENDING)
  initiatedById    String?
  createdAt        DateTime     @default(now())
  updatedAt        DateTime     @updatedAt
  order            Order        @relation(fields: [orderId], references: [id])

  @@index([orderId])
}

model PaymentAccount {
  id                String   @id @default(uuid(7))
  userId            String   @unique
  provider          String   @default("stripe")
  providerAccountId String   @unique
  country           String   @default("IT") @db.Char(2)
  transfersEnabled  Boolean  @default(false)
  payoutsEnabled    Boolean  @default(false)
  detailsSubmitted  Boolean  @default(false)
  requirements      Json?
  disabledReason    String?
  createdAt         DateTime @default(now())
  updatedAt         DateTime @updatedAt
  user              User     @relation(fields: [userId], references: [id])
}

model LedgerTransaction {
  id          String        @id @default(uuid(7))
  orderId     String?
  type        String
  description String?
  externalRef String?       @unique
  createdAt   DateTime      @default(now())
  order       Order?        @relation(fields: [orderId], references: [id])
  entries     LedgerEntry[]

  @@index([orderId])
}

model LedgerEntry {
  id            String            @id @default(uuid(7))
  transactionId String
  account       LedgerAccount
  direction     LedgerDirection
  amountCents   Int
  userId        String?
  createdAt     DateTime          @default(now())
  transaction   LedgerTransaction @relation(fields: [transactionId], references: [id])

  @@index([account, userId])
  @@index([transactionId])
}

model WebhookEvent {
  provider    String
  eventId     String
  type        String
  payload     Json
  receivedAt  DateTime  @default(now())
  processedAt DateTime?
  attempts    Int       @default(0)
  lastError   String?

  @@id([provider, eventId])
  @@index([processedAt])
}

model IdempotencyKey {
  userId         String
  key            String
  endpoint       String
  requestHash    String
  responseStatus Int?
  responseBody   Json?
  createdAt      DateTime @default(now())
  expiresAt      DateTime

  @@id([userId, key])
  @@index([expiresAt])
}

// ─────────────────── CONTROVERSIE E CHARGEBACK ───────────────────

model Dispute {
  id                  String            @id @default(uuid(7))
  orderId             String            @unique
  openedById          String
  reason              DisputeReason
  description         String            @db.Text
  status              DisputeStatus     @default(OPEN)
  outcome             DisputeOutcome?
  proposedRefundCents Int?
  resolvedRefundCents Int?
  sellerResponseDueAt DateTime?
  buyerResponseDueAt  DateTime?
  returnDueAt         DateTime?
  escalatedAt         DateTime?
  resolvedAt          DateTime?
  resolvedById        String?
  resolutionNotes     String?           @db.Text
  appealedAt          DateTime?
  createdAt           DateTime          @default(now())
  updatedAt           DateTime          @updatedAt
  order               Order             @relation(fields: [orderId], references: [id])
  messages            DisputeMessage[]
  evidence            DisputeEvidence[]

  @@index([status])
}

model DisputeMessage {
  id         String    @id @default(uuid(7))
  disputeId  String
  authorId   String?
  authorRole PartyRole
  body       String    @db.Text
  createdAt  DateTime  @default(now())
  dispute    Dispute   @relation(fields: [disputeId], references: [id], onDelete: Cascade)

  @@index([disputeId, createdAt])
}

model DisputeEvidence {
  id           String   @id @default(uuid(7))
  disputeId    String
  uploadedById String
  storageKey   String
  mimeType     String
  createdAt    DateTime @default(now())
  dispute      Dispute  @relation(fields: [disputeId], references: [id], onDelete: Cascade)

  @@index([disputeId])
}

model PaymentDispute {
  id                String    @id @default(uuid(7))
  orderId           String
  providerDisputeId String    @unique
  amountCents       Int
  reason            String
  status            String
  evidenceDueBy     DateTime?
  createdAt         DateTime  @default(now())
  updatedAt         DateTime  @updatedAt
  order             Order     @relation(fields: [orderId], references: [id])

  @@index([orderId])
}

// ─────────────────────── FEEDBACK E REPUTAZIONE ───────────────────────

model Feedback {
  id                 String                   @id @default(uuid(7))
  orderId            String
  authorId           String
  recipientId        String
  role               FeedbackRole
  rating             FeedbackRating
  comment            String?                  @db.VarChar(500)
  dsrItemAsDescribed Int?                     @db.SmallInt
  dsrCommunication   Int?                     @db.SmallInt
  dsrShippingTime    Int?                     @db.SmallInt
  dsrPackaging       Int?                     @db.SmallInt
  weekKey            String
  countsTowardScore  Boolean                  @default(true)
  status             FeedbackStatus           @default(PUBLISHED)
  reply              String?                  @db.VarChar(500)
  repliedAt          DateTime?
  previousRating     FeedbackRating?
  previousComment    String?                  @db.VarChar(500)
  revisedAt          DateTime?
  removedReason      String?
  removedById        String?
  createdAt          DateTime                 @default(now())
  updatedAt          DateTime                 @updatedAt
  order              Order                    @relation(fields: [orderId], references: [id])
  author             User                     @relation("FeedbackAuthor", fields: [authorId], references: [id])
  recipient          User                     @relation("FeedbackRecipient", fields: [recipientId], references: [id])
  revisionRequest    FeedbackRevisionRequest?

  @@unique([orderId, role])
  @@index([recipientId, role, createdAt])
  @@index([authorId, recipientId, weekKey])
}

model FeedbackRevisionRequest {
  id          String                @id @default(uuid(7))
  feedbackId  String                @unique
  requesterId String
  message     String                @db.VarChar(500)
  status      RevisionRequestStatus @default(PENDING)
  expiresAt   DateTime
  respondedAt DateTime?
  createdAt   DateTime              @default(now())
  feedback    Feedback              @relation(fields: [feedbackId], references: [id], onDelete: Cascade)

  @@index([requesterId, createdAt])
}

model UserReputation {
  userId                  String    @id
  score                   Int       @default(0)
  levelKey                String?
  sellerPositive12m       Int       @default(0)
  sellerNeutral12m        Int       @default(0)
  sellerNegative12m       Int       @default(0)
  sellerPositivePctBps    Int?
  buyerPositive12m        Int       @default(0)
  dsrItemAsDescribedAvg   Decimal?  @db.Decimal(3, 2)
  dsrItemAsDescribedCount Int       @default(0)
  dsrCommunicationAvg     Decimal?  @db.Decimal(3, 2)
  dsrCommunicationCount   Int       @default(0)
  dsrShippingTimeAvg      Decimal?  @db.Decimal(3, 2)
  dsrShippingTimeCount    Int       @default(0)
  dsrPackagingAvg         Decimal?  @db.Decimal(3, 2)
  dsrPackagingCount       Int       @default(0)
  completedSales          Int       @default(0)
  completedPurchases      Int       @default(0)
  salesVolume12mCents     BigInt    @default(0)
  disputesLost12m         Int       @default(0)
  sellerCancellations12m  Int       @default(0)
  medianResponseMinutes   Int?
  responseRateBps         Int?
  isTopSeller             Boolean   @default(false)
  topSellerSince          DateTime?
  updatedAt               DateTime  @updatedAt
  user                    User      @relation(fields: [userId], references: [id], onDelete: Cascade)
}

// ─────────────────── MODERAZIONE, DSA, AUDIT ───────────────────

model Report {
  id                 String           @id @default(uuid(7))
  reporterId         String?
  reporterEmail      String?
  reporterName       String?
  targetType         ReportTargetType
  targetId           String
  reasonCode         String
  details            String           @db.Text
  isIllegalContent   Boolean          @default(false)
  goodFaithConfirmed Boolean          @default(false)
  status             ReportStatus     @default(OPEN)
  handledById        String?
  decision           String?
  decidedAt          DateTime?
  createdAt          DateTime         @default(now())

  @@index([status, createdAt])
  @@index([targetType, targetId])
}

model ModerationAction {
  id                 String               @id @default(uuid(7))
  moderatorId        String?
  automated          Boolean              @default(false)
  actionType         ModerationActionType
  targetType         ReportTargetType
  targetId           String
  targetUserId       String?
  reportId           String?
  reasonCode         String
  statementOfReasons String               @db.Text
  legalGround        String?
  contractualGround  String?
  appealable         Boolean              @default(true)
  appealedAt         DateTime?
  appealOutcome      String?
  createdAt          DateTime             @default(now())

  @@index([targetType, targetId])
  @@index([targetUserId])
}

model AuditLog {
  id         String   @id @default(uuid(7))
  actorId    String?
  actorRole  String?
  action     String
  entityType String
  entityId   String?
  ip         String?
  userAgent  String?
  metadata   Json?
  createdAt  DateTime @default(now())

  @@index([entityType, entityId])
  @@index([actorId, createdAt])
}

// ─────────────────────────── NOTIFICHE ───────────────────────────

model Notification {
  id        String    @id @default(uuid(7))
  userId    String
  type      String
  title     String
  body      String
  data      Json?
  readAt    DateTime?
  createdAt DateTime  @default(now())
  user      User      @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@index([userId, readAt, createdAt])
}

model NotificationPreference {
  userId  String
  type    String
  channel NotificationChannel
  enabled Boolean             @default(true)
  user    User                @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@id([userId, type, channel])
}

model PushSubscription {
  id        String   @id @default(uuid(7))
  userId    String
  endpoint  String   @unique
  p256dh    String
  auth      String
  userAgent String?
  createdAt DateTime @default(now())
  user      User     @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@index([userId])
}

// ─────────────────────── FISCO (DAC7) ───────────────────────

model TaxProfile {
  userId         String    @id
  legalName      String
  birthDateEnc   String?
  taxIdEnc       String
  taxIdHash      String
  taxIdCountry   String    @default("IT") @db.Char(2)
  vatNumber      String?
  addressLine    String
  cap            String
  city           String
  country        String    @default("IT") @db.Char(2)
  ibanEnc        String?
  collectedAt    DateTime  @default(now())
  verifiedAt     DateTime?
  remindersSent  Int       @default(0)
  lastReminderAt DateTime?
  updatedAt      DateTime  @updatedAt
  user           User      @relation(fields: [userId], references: [id])

  @@index([taxIdHash])
}

model Dac7Period {
  id                 String @id @default(uuid(7))
  userId             String
  year               Int
  quarter            Int    @db.SmallInt
  considerationCents BigInt @default(0)
  feesCents          BigInt @default(0)
  activitiesCount    Int    @default(0)
  user               User   @relation(fields: [userId], references: [id])

  @@unique([userId, year, quarter])
}

// ─────────────────────────── PIATTAFORMA ───────────────────────────

model PlatformSetting {
  key         String   @id
  value       Json
  updatedById String?
  updatedAt   DateTime @updatedAt
}

model Holiday {
  date DateTime @id @db.Date
  name String
}

model OutboxEvent {
  id            String       @id @default(uuid(7))
  aggregateType String
  aggregateId   String
  type          String
  payload       Json
  status        OutboxStatus @default(PENDING)
  attempts      Int          @default(0)
  availableAt   DateTime     @default(now())
  processedAt   DateTime?
  lastError     String?
  createdAt     DateTime     @default(now())

  @@index([status, availableAt])
}
```

### 10.2 Migrazione SQL aggiuntiva (vincoli e indici che Prisma non esprime)

Crea una migrazione con `prisma migrate dev --create-only` e aggiungi:

```sql
-- Un solo ordine "attivo" per annuncio: impedisce il doppio acquisto anche in caso di richieste concorrenti
CREATE UNIQUE INDEX "Order_one_active_per_listing" ON "Order" ("listingId")
  WHERE "status" IN ('CHECKOUT_PENDING','PAID','HANDOVER_PENDING','SHIPPED','DELIVERED','DISPUTED','RETURN_IN_TRANSIT');

-- Vincoli di dominio
ALTER TABLE "Listing" ADD CONSTRAINT "Listing_price_positive" CHECK ("priceCents" > 0);
ALTER TABLE "Order" ADD CONSTRAINT "Order_amounts_valid" CHECK (
  "itemPriceCents" > 0 AND "shippingPriceCents" >= 0 AND "buyerFeeCents" >= 0
  AND "refundedCents" >= 0 AND "refundedCents" <= "totalCents"
  AND "totalCents" = "itemPriceCents" + "shippingPriceCents" + "buyerFeeCents");
ALTER TABLE "Feedback" ADD CONSTRAINT "Feedback_dsr_range" CHECK (
  ("dsrItemAsDescribed" IS NULL OR "dsrItemAsDescribed" BETWEEN 1 AND 5) AND
  ("dsrCommunication"   IS NULL OR "dsrCommunication"   BETWEEN 1 AND 5) AND
  ("dsrShippingTime"    IS NULL OR "dsrShippingTime"    BETWEEN 1 AND 5) AND
  ("dsrPackaging"       IS NULL OR "dsrPackaging"       BETWEEN 1 AND 5));
ALTER TABLE "Feedback" ADD CONSTRAINT "Feedback_seller_only_positive"
  CHECK ("role" <> 'SELLER_TO_BUYER' OR "rating" = 'POSITIVE');
ALTER TABLE "LedgerEntry" ADD CONSTRAINT "LedgerEntry_amount_positive" CHECK ("amountCents" > 0);

-- Ricerca di riserva e filtri sugli attributi
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX "Listing_title_trgm" ON "Listing" USING gin ("title" gin_trgm_ops);
CREATE INDEX "Listing_attributes_gin" ON "Listing" USING gin ("attributes" jsonb_path_ops);
```

Il test di concorrenza del §6.12 deve dimostrare che l'indice parziale blocca il secondo acquisto.

### 10.3 Altre regole sui dati

- **Cifratura a livello di campo** per codice fiscale, data di nascita e IBAN (`*Enc`): AES-256-GCM con chiave da `ENCRYPTION_KEY` (in produzione da un gestore di segreti/KMS), con *key id* nel ciphertext per poter ruotare le chiavi. Per le ricerche si usa un *blind index* HMAC (`taxIdHash`).
- **Validazione degli attributi:** lo schema Zod di ogni categoria si costruisce a runtime da `CategoryAttribute` + `AttributeDefinition`; i valori non previsti vengono rifiutati.
- **Soft delete** per annunci e utenti. La cancellazione dell'account anonimizza i dati personali (nome, email, username, bio, avatar, indirizzi, sessioni) e conserva ordini, ledger e feedback per gli obblighi di legge, con autore mostrato come "Utente eliminato".
- **Numero d'ordine** leggibile: anno a due cifre + 6 caratteri Crockford base32 (es. `26-4F7K9Q`), univoco.
- **`shortId` degli annunci:** 8 caratteri Crockford base32 casuali, univoci; URL `/annuncio/{slug}-{shortId}`.

---

## 11. API

### 11.1 Convenzioni

- Base `/api/v1`; Better Auth su `/api/auth/*`; documentazione OpenAPI su `/api/docs` (solo sviluppo e staging); health check `/health/live` e `/health/ready` (database, Valkey, Meilisearch, storage).
- JSON in camelCase; date ISO 8601 in UTC; importi come interi `…Cents` con `currency`.
- Paginazione a cursore `?cursor=&limit=` (massimo 50) con risposta `{ items, nextCursor }`; la ricerca usa `page` e `hitsPerPage` (massimo 48).
- Errori Problem Details (RFC 9457): `{ type, title, status, detail, code, errors? }` con `code` stabile (es. `LISTING_NOT_PURCHASABLE`, `ORDER_INVALID_TRANSITION`, `STEP_UP_REQUIRED`).
- `Idempotency-Key` obbligatorio dove indicato con **(I)**. Step-up richiesto dove indicato con **(S)**: se manca, risposta 401 con `code = STEP_UP_REQUIRED`.
- Rate limit con header standard `RateLimit-*` (§13.2). Protezione CSRF: cookie `SameSite=Lax`, controllo dell'header `Origin` sulle richieste di modifica, verifiche integrate di Better Auth.
- Accesso: **P** pubblico, **U** utente autenticato con email verificata, **Pr** proprietario della risorsa o parte dell'ordine, **St** staff con ruolo adeguato e 2FA.

### 11.2 Endpoint

**Utenti e profili**

| Metodo e percorso | Accesso | Note |
|---|---|---|
| `GET /me`, `PATCH /me` | U | profilo e impostazioni |
| `GET/POST/PATCH/DELETE /me/addresses[/:id]` | U | indirizzi di spedizione e mittente |
| `GET /users/:username`, `GET /users/:username/listings` | P | profilo pubblico |
| `PUT/DELETE /users/:id/follow`, `PUT/DELETE /users/:id/block` | U | segui e blocca |
| `POST /me/export` | U (S) | export GDPR via email con link temporaneo |
| `DELETE /me` | U (S) | anonimizzazione; bloccata con ordini aperti |

**Catalogo e geografia**

| Metodo e percorso | Accesso | Note |
|---|---|---|
| `GET /catalog/departments` | P | albero reparti → categorie |
| `GET /catalog/categories/:id/attributes` | P | definizioni per il form e i filtri |
| `GET /catalog/brands?q=` | P | autocompletamento marche |
| `GET /geo/comuni?q=`, `GET /geo/regioni`, `GET /geo/province?regione=` | P | autocompletamento località |

**Annunci e media**

| Metodo e percorso | Accesso | Note |
|---|---|---|
| `POST /listings` | U | crea una bozza |
| `GET /listings/:idOrShortId` | P | le bozze sono visibili solo al proprietario |
| `PATCH /listings/:id` | Pr | modifica (le modifiche sostanziali ripassano i controlli) |
| `POST /listings/:id/{publish,pause,resume,renew,bump,mark-sold}` | Pr | ciclo di vita |
| `DELETE /listings/:id` | Pr | soft delete |
| `GET /me/listings?status=` | U | i miei annunci |
| `GET /listings/:id/similar` | P | annunci simili |
| `POST /media/upload-url` | U | POST firmato per l'upload diretto |
| `POST /listings/:id/images`, `PATCH /listings/:id/images/order`, `DELETE /listings/:id/images/:imageId` | Pr | gestione foto |

**Ricerca, preferiti, seguiti**

| Metodo e percorso | Accesso | Note |
|---|---|---|
| `GET /search/listings` | P | parametri: `q`, `department`, `category`, `brand[]`, `priceMin`, `priceMax`, `condition[]`, `region`, `province`, `comune`, `radiusKm`, `sellerType`, `protectedPayment`, `shipping`, `handDelivery`, `yearMin`, `yearMax`, `attr.<chiave>`, `topSeller`, `sort` (`relevance`, `newest`, `price_asc`, `price_desc`, `distance`), `page`, `hitsPerPage` |
| `GET /search/suggest?q=` | P | suggerimenti |
| `GET/POST/PATCH/DELETE /me/saved-searches[/:id]` | U | ricerche salvate e frequenza avvisi |
| `GET /me/favorites`, `PUT/DELETE /listings/:id/favorite` | U | preferiti |
| `GET /me/recently-viewed`, `POST /me/recently-viewed` | U | sincronizza anche quelli salvati in locale prima del login |
| `GET /me/feed/following` | U | nuovi annunci degli utenti seguiti |

**Messaggi e offerte**

| Metodo e percorso | Accesso | Note |
|---|---|---|
| `GET /conversations?cursor=` | U | le mie conversazioni |
| `POST /conversations` | U | `{ listingId, body }` |
| `GET /conversations/:id/messages?cursor=`, `POST /conversations/:id/messages` | Pr | lettura e invio |
| `POST /conversations/:id/{read,archive}` | Pr | stato |
| `POST /listings/:id/offers` | U | `{ amountCents }` |
| `POST /offers/:id/{accept,decline,counter,withdraw}` | Pr | `counter` con `{ amountCents }` |
| `GET /me/offers?role=` | U | elenco; `role` vale `buyer` o `seller` |
| WebSocket `/ws` | U | eventi del §5.6 |

**Ordini e pagamenti**

| Metodo e percorso | Accesso | Note |
|---|---|---|
| `POST /orders` | U (I) | `{ listingId, deliveryMethod, addressId?, servicePointId?, offerId? }` → `{ orderId, clientSecret, amounts }` |
| `GET /orders/:id`, `GET /me/orders?role=&status=` | Pr / U | dettaglio con timeline |
| `POST /orders/:id/ship` | Pr venditore | spedizione autonoma `{ carrier, trackingNumber }` |
| `GET /orders/:id/label` | Pr venditore | URL firmato dell'etichetta |
| `POST /orders/:id/confirm-receipt` | Pr acquirente (I)(S) | completa l'ordine |
| `GET /orders/:id/handover-code` | Pr acquirente (S) | codice e QR |
| `POST /orders/:id/handover/verify` | Pr venditore (I) | `{ code }` |
| `POST /orders/:id/cancel` | Pr venditore (I) | prima della spedizione |
| `POST /orders/:id/cancel-requests`, `POST /orders/:id/cancel-requests/accept` | Pr | annullamento concordato |
| `POST /orders/:id/dispute` | Pr acquirente (I) | `{ reason, description, evidenceKeys[] }` |
| `POST /payments/onboarding` | U (S) | link o sessione di onboarding Stripe |
| `GET /payments/account` | U | stato dell'account connesso |
| `POST /payments/account-session` | U | sessione per i componenti embedded (saldo, bonifici) |
| `GET /me/balance` | U | trattenuti, in trasferimento, trasferiti (dal ledger) |
| `POST /webhooks/stripe`, `POST /webhooks/shipping/:provider`, `POST /webhooks/tracking/:provider` | firme | corpo grezzo, verifica firma |

**Controversie**

| Metodo e percorso | Accesso | Note |
|---|---|---|
| `GET /disputes/:id` | Pr / St | dettaglio, messaggi, prove |
| `POST /disputes/:id/messages`, `POST /disputes/:id/evidence` | Pr | messaggi e prove (chiavi di upload privato) |
| `POST /disputes/:id/respond` | Pr venditore (I) | `{ action, amountCents?, message }` con `action` tra `ACCEPT_REFUND_WITH_RETURN`, `ACCEPT_REFUND`, `PROPOSE_PARTIAL`, `REJECT` |
| `POST /disputes/:id/{accept-proposal,escalate,withdraw,appeal}` | Pr (I) | azioni delle parti |

**Feedback**

| Metodo e percorso | Accesso | Note |
|---|---|---|
| `GET /users/:username/reputation` | P | aggregati e badge |
| `GET /users/:username/feedback?role=&period=&rating=&cursor=` | P | elenco |
| `GET /me/feedback/pending` | U | feedback da lasciare |
| `POST /orders/:id/feedback` | Pr | giudizio, commento, valutazioni dettagliate |
| `POST /feedback/:id/reply` | Pr destinatario | una sola risposta |
| `POST /feedback/:id/revision-request` | Pr venditore | §8.3 |
| `POST /revision-requests/:id/{accept,decline}` | Pr acquirente | `accept` con nuovo giudizio e commento |
| `POST /feedback/:id/report` | U | segnalazione (anche estorsione) |

**Notifiche, negozi, segnalazioni, fisco**

| Metodo e percorso | Accesso | Note |
|---|---|---|
| `GET /me/notifications`, `POST /me/notifications/read` | U | elenco e lettura |
| `GET/PUT /me/notification-preferences` | U | matrice tipo × canale |
| `POST /shops`, `PATCH /shops/:id` | U / Pr | richiesta e modifica negozio |
| `GET /shops?region=&q=`, `GET /shops/:slug` | P | directory e vetrina |
| `POST /reports` | P (Turnstile) | segnalazione DSA, anche senza account (nome ed email obbligatori, salvo eccezioni di legge) |
| `GET /me/reports`, `POST /moderation-actions/:id/appeal` | U / Pr | stato delle segnalazioni e ricorso |
| `GET/PUT /me/tax-profile` | U (S) | dati DAC7 |

**Backoffice** (tutto **St**, audit di ogni azione)

`GET /admin/dashboard`; `GET /admin/listings?status=` e `POST /admin/listings/:id/{approve,reject,remove,restore}`; `GET /admin/reports` e `POST /admin/reports/:id/decide`; `GET /admin/users?q=`, `POST /admin/users/:id/{sanction,reinstate,impersonate}`; `GET /admin/orders`, `GET /admin/orders/:id`, `POST /admin/orders/:id/refund` (I), `POST /admin/orders/:id/force-transition` (solo admin, motivazione obbligatoria); `GET /admin/disputes`, `POST /admin/disputes/:id/{request-evidence,resolve}`; `GET /admin/feedback?status=`, `POST /admin/feedback/:id/{remove,restore}`; CRUD `/admin/catalog/{departments,categories,attributes,brands}`; `GET/PUT /admin/settings/:key`; `GET /admin/shops?status=`, `POST /admin/shops/:id/{verify,reject}`; `GET /admin/dac7?year=`, `POST /admin/dac7/:userId/remind`, `GET /admin/dac7/export?year=`; `GET /admin/audit`; `GET /admin/webhooks?status=`, `POST /admin/webhooks/:provider/:eventId/replay`; Bull Board su `/admin/queues`.

**Solo sviluppo** (disattivati in produzione da un guard): `POST /dev/shipments/:id/advance`, `POST /dev/orders/:id/run-next-action` (esegue subito il timer, per gli e2e).

---

## 12. Frontend

### 12.1 Mappa delle pagine

next-intl con italiano predefinito senza prefisso (`localePrefix: 'as-needed'`); l'inglese, quando arriverà, sotto `/en`.

| Percorso | Rendering | Note |
|---|---|---|
| `/` | statico + cache | ricerca, reparti, annunci recenti, negozi, guida sicurezza, invito a vendere |
| `/annunci` | SSR dinamico | risultati di ricerca con filtri nell'URL |
| `/categoria/[reparto]`, `/categoria/[reparto]/[categoria]`, `/categoria/[reparto]/[categoria]/[marca]` | SSR + tag di cache | pagine SEO con URL canonico |
| `/marca/[marca]` | SSR + cache | pagina marca |
| `/annuncio/[slug]-[shortId]` | SSR + tag `listing:{id}` | dettaglio, JSON-LD |
| `/utente/[username]`, `/utente/[username]/feedback` | SSR + cache | profilo e feedback |
| `/negozi`, `/negozio/[slug]` | SSR + cache | directory e vetrina |
| `/vendi` | client (autenticato) | wizard |
| `/accedi`, `/registrati`, `/password-dimenticata`, `/reimposta-password`, `/verifica-email` | client | autenticazione |
| `/messaggi`, `/messaggi/[id]` | client (autenticato) | chat in tempo reale |
| `/checkout/[orderId]` | client (autenticato) | Payment Element |
| `/account`, `/account/annunci`, `/account/annunci/[id]/modifica`, `/account/preferiti`, `/account/ricerche-salvate`, `/account/visti-di-recente`, `/account/seguiti` | autenticato | area personale |
| `/account/acquisti[/[orderId]]`, `/account/acquisti/[orderId]/controversia`, `/account/vendite[/[orderId]]`, `/account/incassi`, `/account/feedback`, `/account/negozio` | autenticato | ordini, controversie, incassi, feedback |
| `/account/impostazioni/{profilo,indirizzi,sicurezza,notifiche,privacy,dati-fiscali}` | autenticato | impostazioni |
| `/come-funziona/pagamento-protetto`, `/sicurezza`, `/guide/[slug]`, `/aiuto`, `/come-funzionano-i-feedback`, `/parametri-di-classificazione` | statico (MDX) | contenuti |
| `/termini`, `/condizioni-pagamento-protetto`, `/privacy`, `/cookie`, `/regole-pubblicazione`, `/note-legali`, `/segnala` | statico / client | legali e modulo di segnalazione |
| `/admin/...` | autenticato staff | backoffice |
| `/sitemap.xml`, `/robots.txt`, `/manifest.webmanifest` | generati | SEO e PWA |
| `/api/revalidate` | route handler | invalidazione dei tag, protetta da secret |

### 12.2 Interfaccia e design system

- **Direzione visiva** (da raffinare con un designer): calda e artigianale, foto protagoniste, sfondo neutro, testo color inchiostro, accento color **ottone** per le azioni principali, verde per il badge "Pagamento protetto". Un serif espressivo per i titoli (es. Fraunces) e un sans molto leggibile per l'interfaccia (es. Inter o Geist), caricati con `next/font` (self-hosted, nessuna chiamata a CDN esterne). Tema chiaro e scuro. Nessuna somiglianza grafica con il sito di riferimento.
- **Mobile:** barra inferiore con Home, Cerca, Vendi, Messaggi, Account; filtri in un pannello a scorrimento.
- **Componenti chiave** in `packages/ui`: `ListingCard`, `ListingGallery`, `PriceTag`, `TrustBadges`, `SellerCard`, `FilterPanel`, `FacetChips`, `SearchCombobox`, `CategoryPicker`, `ImageUploader` (trascinamento, riordino, avanzamento), `StepWizard`, `ChatThread`, `OfferComposer`, `OrderTimeline`, `CheckoutSummary`, `HandoverCode` (cifre + QR), `DisputeWizard`, `FeedbackForm` (stelle come gruppi radio accessibili), `ReputationSummary`, `NotificationBell`, `CookieBanner`, stati vuoti e skeleton.
- **Form:** React Hook Form + resolver Zod con gli schemi condivisi; errori in linea annunciati con `aria-live`.
- **Formattazione:** `Intl` con `it-IT` (es. "1.234,56 €", "30 ott 2026", "2 ore fa"); orari mostrati nel fuso Europe/Rome.
- **Dati:** i Server Component leggono tramite `packages/sdk` inoltrando i cookie; le mutazioni passano dall'SDK lato client con TanStack Query (aggiornamenti ottimistici dove ha senso).

### 12.3 SEO

- `generateMetadata` per ogni pagina, URL canonici, Open Graph (prima foto in JPEG 1200 px).
- **JSON-LD:** `Product` + `Offer` nella pagina annuncio (prezzo, `priceCurrency: EUR`, `itemCondition`: `NewCondition`, `UsedCondition` oppure `DamagedCondition` per "da riparare"; `availability`: `InStock` o `SoldOut`); `BreadcrumbList`; `WebSite` con `SearchAction` e `Organization` in home. **Non** inserire `AggregateRating` del venditore nel `Product`: le valutazioni del venditore non sono recensioni del prodotto.
- **Sitemap:** indice + sitemap paginate (annunci, categorie, marche, negozi, pagine statiche) con `lastmod`, rigenerate ogni ora.
- `robots.txt`: esclude `/account`, `/admin`, `/checkout`, `/messaggi`, `/api`.
- Regole `noindex` per faccette e annunci venduti (§3.3 e §9.3).

### 12.4 PWA, accessibilità, prestazioni

- **PWA:** manifest, icone, service worker minimale con pagina offline; installabile. Notifiche push nella fase 2.
- **Accessibilità (WCAG 2.2 AA):** navigazione completa da tastiera (galleria e filtri compresi), focus visibile, link "salta al contenuto", testo alternativo delle foto (inserito dal venditore, altrimenti generato da titolo e posizione), contrasti verificati, `prefers-reduced-motion`, etichette di tutti i campi. Controlli axe automatici negli e2e e pagina "Dichiarazione di accessibilità".
- **Budget di prestazioni** (p75, mobile 4G): LCP < 2,5 s, INP < 200 ms, CLS < 0,1; JavaScript della pagina annuncio < 180 KB compressi; Suspense con skeleton per lo streaming.
- **Analytics** rispettosi della privacy (Plausible o Umami self-hosted), attivati secondo le scelte del banner cookie. Eventi: ricerca, visualizzazione annuncio, contatto, offerta, inizio checkout, acquisto, annuncio pubblicato.

---

## 13. Sicurezza e anti-frode

### 13.1 Obiettivo

OWASP ASVS livello 2 e OWASP Top 10. In `docs/SECURITY.md` un *threat model* STRIDE sintetico, aggiornato a ogni fase.

### 13.2 Rate limit (Valkey, per IP e per utente)

| Azione | Limite di partenza |
|---|---|
| Login | 5/min per IP e 10/ora per account, poi Turnstile |
| Registrazione | 3/ora per IP |
| Reset password | 3/ora per account |
| Nuove conversazioni | 30/giorno (10/giorno per account con meno di 7 giorni) |
| Messaggi | 30/min per utente |
| Offerte | 20/giorno per utente |
| Creazione annunci | 20/giorno (5/giorno per account con meno di 7 giorni) |
| Segnalazioni | 10/giorno per utente o IP |
| Codice di consegna a mano | 5 tentativi per ordine, poi blocco di 1 ora |
| Ricerca anonima | 60/min per IP |

### 13.3 Protezione degli account

- Hash delle password gestito da Better Auth (nessuna crittografia fatta in casa).
- **Dispositivi riconosciuti:** cookie firmato a lunga durata con id dispositivo, salvato come hash in `KnownDevice`. Accesso da un dispositivo nuovo → email di avviso con link "Non sono stato io" (revoca le sessioni e forza il cambio password).
- **Step-up** (§3.1): ri-autenticazione se l'ultima autenticazione ha più di 10 minuti; in più un codice via email se il dispositivo è nuovo da meno di 24 ore.
- Il cambio password revoca le altre sessioni. Elenco delle sessioni con revoca.
- 2FA obbligatoria per lo staff; suggerita ai venditori.

### 13.4 Anti-truffa nella chat

Funzione pura `scanMessage(text)` in `packages/domain`, testata su un corpus di esempi in italiano (incluse varianti offuscate come "tre tre nove", "punto com", numeri spaziati):
- **Link:** mai cliccabili, tranne quelli del dominio della piattaforma; banner di avviso.
- **Telefono ed email:** mascherati finché entrambe le parti non hanno scritto almeno un messaggio **e** il mittente ha un account di almeno 7 giorni. Il testo spiega perché.
- **IBAN, "bonifico", "ricarica", "Western Union", "corriere mio", "pagamento fuori", "link per ricevere il pagamento", nomi di app di messaggistica:** messaggio consegnato con flag e avviso evidente al destinatario: "Paga solo con il pagamento protetto: fuori dalla piattaforma non sei tutelato".
- **Comportamenti sospetti:** 5 o più messaggi con flag in 24 ore verso conversazioni diverse → account `LIMITED` e revisione dello staff.
- **Educazione:** banner fissi, per esempio "Non ti chiederemo mai di inserire i dati della carta per *ricevere* un pagamento" e "Le notifiche ufficiali arrivano solo nell'app e dal nostro dominio".

### 13.5 Controlli automatici sugli annunci

- Parole vietate e frasi sospette (lista configurabile).
- **Prezzo anomalo:** sotto il 35% della mediana di (categoria, marca) con almeno 20 campioni → `PENDING_REVIEW`.
- **Foto riutilizzate:** hash percettivo uguale o molto simile (distanza di Hamming ≤ 6) a foto di un altro venditore → `PENDING_REVIEW`.
- Venditore con meno di 30 giorni e prezzo superiore a 2.000 € → revisione.
- Troppi annunci in poco tempo da un account nuovo → limite.
- **Articoli vietati o limitati** (pagina "Regole di pubblicazione"): armi, contraffazioni, software piratato o licenze non trasferibili, refurtiva, strumenti con parti in materiali protetti CITES senza documentazione (es. avorio, tartaruga, palissandro brasiliano), qualsiasi oggetto illegale.

### 13.6 Sicurezza della piattaforma

- **Header:** CSP con nonce generata in `proxy.ts` (allowlist: Stripe, Turnstile, CDN dei media, API e WebSocket, Sentry), HSTS, `X-Content-Type-Options`, `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy` minima, `frame-ancestors 'none'`.
- **Input e output:** validazione Zod ovunque; descrizioni e messaggi trattati come testo semplice (nessun HTML o Markdown renderizzato, solo a capo).
- **Upload** (§5.9): tipi e dimensioni limitati, verifica dei magic bytes, ricodifica delle immagini.
- **Autorizzazione** a livello di risorsa con test anti-IDOR per ogni endpoint con parametro id.
- **Database:** utente applicativo senza privilegi di superuser; utente separato per le migrazioni; `AuditLog` in sola aggiunta (nessun permesso di UPDATE o DELETE per l'utente applicativo).
- **Webhook:** firma verificata sul corpo grezzo; nessuna chiamata server a URL forniti dagli utenti (prevenzione SSRF).
- **Log:** pino con redazione di password, token, cookie, header `Authorization`, IBAN, codice fiscale. I dati delle carte non passano mai dai nostri server.
- **Supply chain:** `pnpm audit`, Renovate, CodeQL, gitleaks in CI.
- **Admin:** 2FA, step-up per rimborsi, sanzioni e impostazioni; allowlist IP opzionale; audit di ogni azione.

### 13.7 Minacce principali e contromisure

| Minaccia | Contromisure |
|---|---|
| Furto di account tramite phishing per confermare la ricezione | step-up sulla conferma, avvisi di nuovo dispositivo, link non cliccabili in chat, educazione |
| Acquisto con carta rubata (truffa a triangolo) | Radar, 3DS sopra soglia, limiti per account nuovi, spedizione solo all'indirizzo dell'ordine |
| Pacco vuoto o oggetto diverso | controversie con prove, tracking, verifica del reso, numero di serie facoltativo per gli oggetti di valore |
| Reso di un oggetto diverso da quello venduto | 48 ore al venditore per contestare il reso, decisione del supporto |
| Venditore fantasma con foto rubate | hash percettivo, revisione degli annunci di valore degli account nuovi, KYC prima di incassare |
| Feedback gonfiati | feedback solo da ordini completati, deduplicazione, soglia minima, rilevazione di collusioni (§8.8) |
| Collusione per riciclaggio | blocco degli ordini tra account con dispositivo, IP o carta in comune; monitoraggio delle coppie ricorrenti |
| Spam e scraping | rate limit, Turnstile, limiti per account nuovi |

---

## 14. Conformità normativa (Italia/UE)

> Questa è una **checklist tecnica**, non una consulenza legale. Ogni punto va confermato da un avvocato (marketplace, consumo, privacy) e da un commercialista (IVA, DAC7) prima del lancio. In `docs/COMPLIANCE.md` tieni lo stato di ogni voce.

### 14.1 Pagamenti

- Nessuna custodia di fondi da parte della piattaforma; tutto passa da Stripe (§6.1). SCA/3DS gestita da Stripe.
- Testi "Condizioni del pagamento protetto" e "Protezione venditore" da validare.

### 14.2 Digital Services Act

- **Obblighi di base** (validi per tutti i servizi di hosting): punti di contatto per autorità e utenti; termini di servizio che spiegano la moderazione; **meccanismo di segnalazione** (notice & action) con conferma di ricezione e comunicazione della decisione; **motivazione** (statement of reasons) inviata all'utente colpito da ogni restrizione; obbligo di segnalare alle autorità sospetti reati che minacciano la vita o la sicurezza delle persone.
- **Obblighi delle piattaforme e dei marketplace** (sistema interno di reclamo, tracciabilità degli operatori commerciali, "compliance by design", diritto all'informazione…): le micro e piccole imprese (meno di 50 dipendenti e fatturato fino a 10 milioni di euro) ne sono esentate, ma **non** dagli obblighi di base. Implementali comunque come buona pratica (ricorsi, dati e autocertificazione dei negozi, campi per le informazioni precontrattuali, nessun *dark pattern*, trasparenza sui criteri di classificazione) e rivaluta l'esenzione con la crescita.
- La relazione annuale di trasparenza non è dovuta dalle micro e piccole imprese; predisponi comunque le statistiche (segnalazioni, azioni, tempi) nel backoffice.

### 14.3 Diritto dei consumatori (Codice del Consumo, direttiva Omnibus)

- Indicare su ogni annuncio se il venditore è un **professionista** (negozio) o un **privato**, in base alla sua dichiarazione; per i privati spiegare che i diritti dei consumatori dell'UE (es. recesso) non si applicano al contratto.
- Pagina sui **principali parametri di classificazione** dei risultati (`/parametri-di-classificazione`).
- Informativa su **se e come** si verifica che le recensioni provengano da chi ha davvero acquistato (§8.8); divieto di recensioni false.
- **Annunci di riduzione di prezzo dei negozi:** indicare il prezzo più basso applicato nei 30 giorni precedenti.
- **Negozi (B2C):** informazioni su diritto di recesso (14 giorni), garanzia legale di conformità e politica resi (campi `returnPolicy` e `warrantyInfo`), informazioni precontrattuali.

### 14.4 DAC7 (obblighi fiscali delle piattaforme)

- Sono esclusi dalla comunicazione i venditori con **meno di 30 operazioni e non più di 2.000 €** di corrispettivi nell'anno sulla piattaforma; basta superare **una** delle due soglie per diventare soggetti a comunicazione.
- Comunicazione annuale all'Agenzia delle Entrate **entro il 31 gennaio** dell'anno successivo; per comunicazioni omesse o errate sono previste sanzioni.
- Implementazione:
  - corrispettivi, commissioni e numero di operazioni per trimestre in `Dac7Period`, calcolati dagli ordini con pagamento protetto (corrispettivo noto). Per gli affari conclusi fuori piattaforma il corrispettivo non è noto: trattamento da confermare con il consulente;
  - richiesta dei dati (`TaxProfile`: nome, indirizzo, codice fiscale, data di nascita, P.IVA se presente, IBAN) quando il venditore raggiunge l'80% di una delle soglie;
  - solleciti automatici; se i dati non arrivano, blocco di nuovi incassi secondo quanto previsto dalla normativa (da verificare);
  - export annuale: nell'MVP CSV completo e modello dati pronto; il tracciato ufficiale dell'Agenzia delle Entrate in una fase successiva.

### 14.5 Privacy (GDPR) e cookie

- Registro dei trattamenti e basi giuridiche: contratto (account, ordini), obbligo legale (DAC7, contabilità), legittimo interesse (sicurezza, prevenzione frodi), consenso (marketing, cookie analitici non anonimizzati).
- Accordi di trattamento (DPA) con i fornitori: hosting, provider email, provider spedizioni, Meilisearch Cloud, Sentry. Stripe agisce in parte come titolare autonomo.
- Valuta una DPIA per il punteggio di rischio antifrode e l'analisi automatica dei messaggi.
- Diritti degli interessati automatizzati (export, cancellazione con anonimizzazione, rettifica), risposta entro un mese. Procedura per i data breach (notifica entro 72 ore).
- **Banner cookie** secondo le linee guida del Garante: nessuna casella preselezionata, "Accetta" e "Rifiuta" ugualmente evidenti, chiusura con la X = nessun consenso, scelte granulari, registro dei consensi, nessuna nuova richiesta prima di 6 mesi.
- Minimizzazione: posizione approssimata, telefono mai pubblico, EXIF rimossi, dati in UE.
- Tabella di conservazione (in `docs/COMPLIANCE.md`, valori da confermare): dati contabili e ordini 10 anni; dati DAC7 per il periodo di legge; messaggi 24 mesi dall'ultima attività salvo controversie o segnalazioni aperte; log applicativi 90 giorni; audit log almeno 2 anni; account eliminati anonimizzati entro 30 giorni.

### 14.6 Accessibilità

Il servizio di commercio elettronico rientra nell'European Accessibility Act (applicabile dal 28 giugno 2025; le microimprese che forniscono servizi sono esentate). Obiettivo WCAG 2.2 AA e "Dichiarazione di accessibilità".

### 14.7 Fisco della piattaforma

La commissione di protezione è un servizio della piattaforma soggetto a IVA (prezzo mostrato IVA inclusa, scorporo nel ledger). Fatturazione elettronica per i clienti con P.IVA, certificazione dei corrispettivi per i privati, export contabile: da definire con il commercialista.

### 14.8 Altro

- Età minima 18 anni per registrarsi.
- Documenti da preparare con il legale: Termini di servizio; Condizioni del pagamento protetto; Protezione venditore; Regole di pubblicazione e articoli vietati; Linee guida feedback; Politica controversie e rimborsi; Informativa privacy; Cookie policy; informazioni DSA (punto di contatto, modulo di segnalazione, politica di moderazione, gestione dei reclami); Dichiarazione di accessibilità; Parametri di classificazione.

---

## 15. Qualità, osservabilità, CI/CD e deploy

### 15.1 Test

- **Unit (Vitest):** `packages/domain` con copertura ≥ 95% (importi, macchina a stati, ledger, reputazione, anti-frode, giorni lavorativi); service dell'API ≥ 80%.
- **Integrazione:** API con Testcontainers (PostgreSQL, Valkey, Meilisearch), Stripe in modalità test o `stripe-mock`, provider di spedizione finto. Builder di dati di test riutilizzabili.
- **E2E (Playwright)**, percorsi obbligatori:
  1. registrazione → verifica email (letta dall'API di Mailpit) → pubblicazione di un annuncio con 5 foto → l'annuncio compare nella ricerca;
  2. acquisto con spedizione integrata → etichetta → eventi simulati → consegna → conferma con step-up → trasferimento → feedback reciproci → reputazione aggiornata;
  3. consegna a mano con codice;
  4. offerta → controproposta → accettazione → checkout al prezzo concordato;
  5. controversia "non conforme" → rimborso parziale → resto trasferito → ledger bilanciato;
  6. chat tra due contesti browser in tempo reale, con avviso su un IBAN;
  7. segnalazione di un annuncio → rimozione da parte del moderatore → email con motivazione → ricorso;
  8. annullamento per mancata spedizione (timer forzato con l'endpoint di sviluppo) → rimborso.
- **Accessibilità:** axe su home, ricerca, annuncio, wizard, checkout, area personale: zero violazioni serie o critiche.
- **Carico (k6):** ricerca 200 richieste/s con p95 < 300 ms; pagina annuncio 100 richieste/s; su un seed di 100.000 annunci.

### 15.2 Osservabilità

- Log JSON (pino) con `requestId` e `userId` (mai dati personali in chiaro); tracce OpenTelemetry (HTTP, Prisma, BullMQ, chiamate esterne); Sentry su web, API e worker con filtro dei dati personali.
- Metriche e alert: errori 5xx, latenza p95, webhook falliti, ritardo delle code > 5 minuti, timer degli ordini scaduti e non eseguiti, differenze di riconciliazione, ordini con fondi trattenuti da oltre 60 giorni, esaurimento delle quote dei provider.

### 15.3 CI (GitHub Actions)

Su ogni pull request: installazione con cache pnpm → `biome check` → typecheck → unit → integrazione (servizi in container) → build → e2e smoke → `pnpm audit`, CodeQL, gitleaks. Tutti i job sono controlli obbligatori. Cache remota di Turborepo facoltativa.

### 15.4 Deploy

- Dockerfile multi-stage per web, API e worker (`node:26-slim`, utente non root, `HEALTHCHECK`, solo dipendenze di produzione).
- `infra/compose/docker-compose.prod.example.yml` con Caddy come reverse proxy (TLS automatico) per un deploy su singola VM.
- Rilascio: `prisma migrate deploy` in uno step dedicato prima del rollout; deploy progressivo; feature flag per le funzioni rischiose.
- Ambienti: locale, staging (Stripe in modalità test, provider in sandbox), produzione. Chiavi live solo in produzione.
- **Backup:** PostgreSQL con PITR (RPO ≤ 5 minuti), dump logico giornaliero su storage separato, versioning del bucket media, test di ripristino mensile documentato in `docs/RUNBOOK.md`. Meilisearch si ricostruisce dal database.
- **Runbook:** webhook in errore, code bloccate, Meilisearch giù (modalità degradata), provider di spedizione giù, rotazione delle chiavi, procedura di data breach.

---

## 16. Piano di lavoro per fasi

Ogni fase: piano in `docs/PROGRESS.md` → implementazione → test → documentazione → commit → riepilogo → **stop**.

### Fase 0 — Bootstrap del monorepo e infrastruttura locale

- `git init`; pnpm workspaces; Turborepo; Biome; tsconfig base `strict`; `.nvmrc` (26); `.editorconfig`; `.gitignore`.
- `apps/web`: Next.js 16 con TypeScript, App Router e Tailwind 4; next-intl (italiano); inizializzazione shadcn/ui; layout con header e footer; home segnaposto in italiano.
- `apps/api`: NestJS 12 (Express); configurazione con validazione Zod delle variabili d'ambiente (avvio bloccato se mancano); pino; filtro errori Problem Details; `/health/live` e `/health/ready`.
- `apps/worker`: NestJS standalone collegato a BullMQ con un job di heartbeat.
- Scheletro di tutti i `packages/*`.
- `infra/compose/docker-compose.yml` (§17.2), `.env.example` (§17.1), script radice (§17.3), creazione automatica dei bucket in sviluppo all'avvio dell'API.
- Workflow CI (lint, typecheck, test, build). `README.md` con avvio in 5 comandi. `CLAUDE.md`. Scheletro di `docs/`.

**Criteri di accettazione:** `pnpm install && pnpm infra:up && pnpm dev` avvia il web su http://localhost:3000 e l'API con `/health/ready` positivo (database, Valkey, Meilisearch, storage); il worker registra il battito; `pnpm lint && pnpm typecheck && pnpm test && pnpm build` sono verdi.

### Fase 1 — Database, seed e dominio puro

- `packages/db`: schema del §10.1, `prisma.config.ts`, migrazione iniziale e migrazione SQL del §10.2, client esportato con `@prisma/adapter-pg`.
- Seed: geografia (elenco ufficiale ISTAT dei comuni con coordinate da una fonte aperta con licenza compatibile, annotata in `docs/DATA_SOURCES.md`; senza rete, solo i capoluoghi di provincia), catalogo e attributi (§19), marche, festività, impostazioni predefinite della piattaforma, dati demo (solo sviluppo).
- `packages/domain`: `computeOrderAmounts`, `OrderStateMachine`, calcolo dei giorni lavorativi, costruttori delle scritture di ledger, calcolo della reputazione, `scanMessage`, prezzo anomalo, distanza tra hash percettivi, generatori di slug, `shortId` e numero d'ordine, validatori di P.IVA e codice fiscale.

**Criteri:** `pnpm db:reset && pnpm db:seed` crea catalogo completo, tutti i comuni (o il fallback) e i dati demo; test di dominio verdi con copertura ≥ 95%.

### Fase 2 — Autenticazione, profili e impostazioni

Better Auth nell'API (email e password, Google, verifica email via Mailpit, reset password, 2FA TOTP, passkey, ruoli); dispositivi riconosciuti e step-up; rate limit; Turnstile con le chiavi di test; pagine di autenticazione; profilo pubblico; impostazioni (profilo, indirizzi, sicurezza, notifiche, privacy); banner cookie; pagine legali segnaposto; template email di autenticazione.

**Criteri:** e2e registrazione → verifica email → login → attivazione 2FA → nuovo login con TOTP; test che un endpoint sensibile restituisca `STEP_UP_REQUIRED`; test anti-IDOR sugli indirizzi; nessuno script di analytics caricato prima del consenso.

### Fase 3 — Catalogo, annunci e media

API e interfaccia del catalogo; CRUD annunci e wizard "Vendi"; pipeline dei media (§5.9); controlli automatici (§13.5); pagina annuncio SSR con JSON-LD e galleria; "I miei annunci"; job di ciclo di vita; storico prezzi; notifiche base (in-app ed email); etichette privato/negozio.

**Criteri:** un annuncio con 5 foto è visibile su `/annuncio/...`; un test verifica che nessuna variante contenga dati EXIF o GPS; un prezzo anomalo manda l'annuncio in revisione; Lighthouse sulla build di produzione locale: SEO e Accessibilità ≥ 90, Performance ≥ 85.

### Fase 4 — Ricerca, navigazione e SEO

Configurazione Meilisearch (§9.2); sincronizzazione via outbox; API di ricerca con faccette, distanza e ordinamenti; autocompletamento; pagina `/annunci` con stato dei filtri nell'URL; pagine di categoria e marca; ricerche salvate e avvisi; visti di recente; feed dei seguiti; sitemap e robots; modalità degradata; `pnpm search:reindex` con scambio degli indici; `pnpm db:seed:big` (100.000 annunci).

**Criteri:** "stratocster" trova "Stratocaster"; i conteggi delle faccette coincidono con il database; il raggio di 30 km da Milano funziona; p95 < 150 ms su 100.000 annunci in locale; l'email della ricerca salvata arriva in Mailpit; con il container di Meilisearch fermo la ricerca funziona in modalità degradata.

### Fase 5 — Messaggistica, offerte e notifiche

Conversazioni, messaggi, gateway WebSocket con adapter Redis, `scanMessage` con mascheramento e avvisi, blocchi e segnalazioni, offerte con controproposta e scadenza, centro notifiche in tempo reale, email secondo le preferenze.

**Criteri:** e2e J6 (§15.1); un telefono inviato da un account nuovo è mascherato; un'offerta accettata riserva l'annuncio per 24 ore; le email rispettano le preferenze.

### Fase 6 — Pagamento protetto e ordini

Onboarding Stripe Connect (Accounts v2) e sincronizzazione di `PaymentAccount`; checkout (`POST /orders` + Payment Element); macchina a stati con lock ottimistico; sweeper; webhook con `WebhookEvent`; ledger; trasferimenti con `source_transaction`; annullamenti e rimborsi; consegna a mano con codice; spedizione autonoma con tracking; conferma di ricezione con step-up; pagine ordine con timeline per acquirente e venditore; pagina Incassi; vista ordini in admin; riconciliazione; `funds-hold-guard`; regole Radar documentate.

**Criteri:** e2e J3 e percorso completo con spedizione autonoma in modalità test di Stripe; due acquisti concorrenti → uno riuscito e uno con 409; webhook duplicato elaborato una volta; invarianti del ledger verdi; trasferimento visibile sull'account connesso nella Dashboard Stripe di test.

### Fase 7 — Spedizioni

**Prima di iniziare chiedi all'utente** quale provider usare (Sendcloud o ShippyPro) e le credenziali sandbox. Se non sono disponibili, completa la fase con l'adapter finto e lascia l'adapter reale dietro feature flag, con test di contratto su payload di esempio.

Porte `ShippingProvider` e `TrackingProvider`; adapter finto con endpoint di sviluppo; adapter reale; taglie e tariffe; etichette e download; webhook di tracking con verifica HMAC; scelta del punto di ritiro al checkout; etichette di reso; guida all'imballaggio.

**Criteri:** e2e J2 completo con l'adapter finto; test della verifica HMAC; con la sandbox disponibile, generazione di un'etichetta reale di test.

### Fase 8 — Controversie, rimborsi, chargeback

Flusso del §6.6 completo; prove nel bucket privato; proposte, escalation, interfaccia di decisione in admin, ricorsi; resi; rimborsi parziali; crediti verso i venditori; gestione dei chargeback con invio delle prove; politica del §6.7 configurabile.

**Criteri:** e2e J5 e J8; chargeback simulato con la carta di test Stripe `4000 0000 0000 0259`; ledger bilanciato in tutti i casi.

### Fase 9 — Feedback e reputazione

Tutto il §8: form, risposte, revisioni, calcoli, livelli, Venditore Top, pagine feedback, badge su card e annunci, moderazione, pagina informativa.

**Criteri:** test del §8.10; e2e "lascia un feedback e vedi la reputazione aggiornata"; il database rifiuta un feedback negativo del venditore.

### Fase 10 — Negozi e diritti dei consumatori

Richiesta e verifica dei negozi, vetrine e directory, etichette e informazioni legali sugli annunci, avviso per i venditori privati, prezzo più basso degli ultimi 30 giorni nei ribassi dei negozi, pagina dei parametri di classificazione.

**Criteri:** l'annuncio di un negozio mostra dati legali e "Venditore professionale"; quello di un privato mostra l'avviso sui diritti dei consumatori; il badge di ribasso di un negozio mostra il prezzo più basso degli ultimi 30 giorni.

### Fase 11 — Moderazione, backoffice, DSA, DAC7, GDPR

Modulo pubblico di segnalazione con Turnstile; code di moderazione; azioni con motivazione e ricorsi; sanzioni; dashboard KPI; editor di impostazioni e catalogo; audit log; log dei webhook con rielaborazione; Bull Board; monitoraggio delle soglie DAC7, `TaxProfile` cifrato, solleciti, export CSV; export e cancellazione GDPR; job di conservazione dei dati.

**Criteri:** e2e J7; le route admin richiedono 2FA; un test legge il database e verifica che i campi fiscali siano cifrati; l'export contiene i dati dell'utente; la cancellazione anonimizza.

### Fase 12 — Hardening, prestazioni, accessibilità, deploy

Revisione di sicurezza sulla checklist del §13; CSP; verifica dei rate limit; test k6; audit axe; budget Lighthouse; PWA; Dockerfile e compose di produzione con Caddy; workflow di deploy verso staging; `RUNBOOK.md` e procedura di backup; README finale.

**Criteri:** J1–J8 verdi in CI; obiettivi k6 raggiunti; zero violazioni axe serie o critiche; il compose di produzione di esempio avvia l'intero stack in locale; checklist del §20 completata.

### 16.2 Roadmap dopo l'MVP

Annunci "Cerco"; directory di artigiani e servizi con recensioni; promozioni a pagamento ("In evidenza", "Rialza"); abbonamento negozi PRO con Stripe Billing, import CSV/feed e statistiche; app mobile Expo sulla stessa API; notifiche web push; mappa degli annunci; stima del prezzo dell'usato basata sulle vendite concluse; registro degli strumenti rubati (numeri di serie con denuncia); pagamento a rate; inglese e vendite nell'UE; API pubblica per i gestionali dei negozi; programma referral.

---

## 17. Configurazione

### 17.1 `.env.example`

```dotenv
# ── Generale ──
NODE_ENV=development
APP_NAME=Accordo
WEB_URL=http://localhost:3000
API_URL=http://localhost:4000
MEDIA_PUBLIC_URL=http://localhost:9000/accordo-media
COOKIE_DOMAIN=localhost
BUSINESS_TIMEZONE=Europe/Rome

# ── Database (Prisma 7 lo legge da prisma.config.ts; a runtime lo usa @prisma/adapter-pg) ──
DATABASE_URL=postgresql://accordo:accordo@localhost:5432/accordo
DATABASE_MIGRATION_URL=postgresql://accordo:accordo@localhost:5432/accordo

# ── Valkey / Redis ──
REDIS_URL=redis://localhost:6379

# ── Meilisearch ──
MEILI_HOST=http://localhost:7700
MEILI_MASTER_KEY=dev_master_key_change_me_please
MEILI_SEARCH_KEY=

# ── Object storage (S3 compatibile) ──
S3_ENDPOINT=http://localhost:9000
S3_REGION=auto
S3_ACCESS_KEY_ID=accordo
S3_SECRET_ACCESS_KEY=accordo-secret
S3_BUCKET_PUBLIC=accordo-media
S3_BUCKET_PRIVATE=accordo-private
S3_FORCE_PATH_STYLE=true

# ── Autenticazione ──
BETTER_AUTH_SECRET=change_me_with_at_least_32_random_characters
BETTER_AUTH_URL=http://localhost:4000
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
DEVICE_COOKIE_SECRET=change_me_with_at_least_32_random_characters
STEP_UP_MAX_AGE_MINUTES=10

# ── Turnstile (in sviluppo usa le chiavi di test indicate nella documentazione Cloudflare) ──
NEXT_PUBLIC_TURNSTILE_SITE_KEY=
TURNSTILE_SECRET_KEY=

# ── Email ──
EMAIL_PROVIDER=smtp
EMAIL_FROM="Accordo <no-reply@accordo.local>"
SMTP_HOST=localhost
SMTP_PORT=1025
EMAIL_PROVIDER_API_KEY=

# ── Stripe ──
STRIPE_SECRET_KEY=sk_test_xxx
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_test_xxx
STRIPE_WEBHOOK_SECRET=whsec_xxx
STRIPE_ACCOUNTS_API=v2

# ── Spedizioni e tracking ──
SHIPPING_PROVIDER=mock
SHIPPING_API_KEY=
SHIPPING_API_SECRET=
SHIPPING_WEBHOOK_SECRET=
TRACKING_PROVIDER=mock

# ── Sicurezza ──
ENCRYPTION_KEY=
ENCRYPTION_KEY_ID=k1
HANDOVER_CODE_PEPPER=change_me
REVALIDATE_SECRET=change_me

# ── Osservabilità ──
SENTRY_DSN=
OTEL_EXPORTER_OTLP_ENDPOINT=
LOG_LEVEL=debug

# ── Regole di business: valori iniziali, poi modificabili da admin (PlatformSetting) ──
BUYER_FEE_BPS=400
BUYER_FEE_FIXED_CENTS=50
BUYER_FEE_MIN_CENTS=100
BUYER_FEE_MAX_CENTS=2500
SELLER_COMMISSION_BPS=0
VAT_RATE_BPS=2200
CHECKOUT_RESERVATION_MINUTES=15
SELLER_SHIP_DEADLINE_BUSINESS_DAYS=5
BUYER_INSPECTION_HOURS=72
SELF_SHIPPING_AUTO_COMPLETE_DAYS=10
HANDOVER_DEADLINE_DAYS=7
DISPUTE_RESPONSE_HOURS=72
DISPUTE_REVIEW_BUSINESS_DAYS=5
RETURN_SHIP_DEADLINE_BUSINESS_DAYS=5
RETURN_INSPECTION_HOURS=48
FUNDS_HOLD_ALERT_DAYS=60
FUNDS_HOLD_MAX_DAYS=85
OFFER_EXPIRY_HOURS=48
OFFER_MIN_PERCENT=50
ACCEPTED_OFFER_CHECKOUT_HOURS=24
LISTING_DURATION_DAYS=60
LISTING_MAX_IMAGES=20
FEEDBACK_WINDOW_DAYS=60
FEEDBACK_MIN_ORDER_CENTS=300
```

`ENCRYPTION_KEY`: 32 byte casuali in base64 (`openssl rand -base64 32`). In produzione tutti i segreti vanno in un gestore di segreti.

### 17.2 `infra/compose/docker-compose.yml` (sviluppo)

Le applicazioni girano sull'host con `pnpm dev`; Docker fornisce solo i servizi. Fissa tag di versione precisi al momento dello scaffolding.

```yaml
name: accordo

services:
  postgres:
    image: postgres:18
    environment:
      POSTGRES_USER: accordo
      POSTGRES_PASSWORD: accordo
      POSTGRES_DB: accordo
    ports: ["5432:5432"]
    volumes:
      - pgdata:/var/lib/postgresql # da PostgreSQL 18 l'immagine ufficiale usa questo percorso
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U accordo -d accordo"]
      interval: 5s
      timeout: 3s
      retries: 20

  valkey:
    image: valkey/valkey:8
    ports: ["6379:6379"]
    healthcheck:
      test: ["CMD", "valkey-cli", "ping"]
      interval: 5s
      timeout: 3s
      retries: 20

  meilisearch:
    image: getmeili/meilisearch:v1.56 # usa l'ultima v1.x stabile
    environment:
      MEILI_MASTER_KEY: ${MEILI_MASTER_KEY:-dev_master_key_change_me_please}
      MEILI_ENV: development
      MEILI_NO_ANALYTICS: "true"
    ports: ["7700:7700"]
    volumes:
      - meilidata:/meili_data

  s3:
    image: rustfs/rustfs:latest # fissa una versione stabile; verifica i nomi delle variabili nella documentazione dell'immagine
    environment:
      RUSTFS_ACCESS_KEY: accordo
      RUSTFS_SECRET_KEY: accordo-secret
    ports: ["9000:9000", "9001:9001"]
    volumes:
      - s3data:/data

  mailpit:
    image: axllent/mailpit:latest
    ports: ["1025:1025", "8025:8025"]

  stripe-cli:
    image: stripe/stripe-cli:latest
    profiles: ["stripe"]
    command: ["listen", "--forward-to", "http://host.docker.internal:4000/api/v1/webhooks/stripe"]
    environment:
      STRIPE_API_KEY: ${STRIPE_SECRET_KEY:-}
    extra_hosts:
      - "host.docker.internal:host-gateway"

volumes:
  pgdata:
  meilidata:
  s3data:
```

### 17.3 Script della radice (`package.json`)

```json
{
  "scripts": {
    "dev": "turbo run dev --parallel",
    "build": "turbo run build",
    "lint": "biome check .",
    "format": "biome format --write .",
    "typecheck": "turbo run typecheck",
    "test": "turbo run test",
    "test:integration": "turbo run test:integration",
    "test:e2e": "playwright test",
    "infra:up": "docker compose -f infra/compose/docker-compose.yml up -d --wait",
    "infra:down": "docker compose -f infra/compose/docker-compose.yml down",
    "db:migrate": "pnpm --filter @accordo/db exec prisma migrate dev",
    "db:deploy": "pnpm --filter @accordo/db exec prisma migrate deploy",
    "db:reset": "pnpm --filter @accordo/db exec prisma migrate reset --force",
    "db:seed": "pnpm --filter @accordo/db run seed",
    "db:seed:demo": "pnpm --filter @accordo/db run seed:demo",
    "db:seed:big": "pnpm --filter @accordo/db run seed:big",
    "db:studio": "pnpm --filter @accordo/db exec prisma studio",
    "geo:import": "tsx scripts/import-geo.ts",
    "search:reindex": "tsx scripts/reindex.ts",
    "stripe:listen": "stripe listen --forward-to localhost:4000/api/v1/webhooks/stripe"
  }
}
```

---

## 18. Glossario italiano → codice

| Italiano (interfaccia) | Nel codice |
|---|---|
| Annuncio | `Listing` |
| Reparto / Categoria / Attributo / Marca | `Department` / `Category` / `AttributeDefinition` / `Brand` |
| Condizione | `ItemCondition` |
| Venditore / Acquirente | `seller` / `buyer` |
| Negozio; privato / professionista | `Shop`; `PRIVATE` / `BUSINESS` |
| Preferiti / Ricerca salvata / Visti di recente / Utenti seguiti | `Favorite` / `SavedSearch` / `RecentlyViewed` / `Follow` |
| Conversazione / Messaggio | `Conversation` / `Message` |
| Offerta / Controproposta | `Offer` / counter offer |
| Ordine | `Order` |
| Pagamento protetto | protected payment |
| Commissione di protezione acquisti | buyer fee (`buyerFeeCents`) |
| Spedizione integrata / autonoma | `SHIPPING_INTEGRATED` / `SHIPPING_SELF` |
| Consegna a mano / Codice di consegna | `HAND_DELIVERY` / handover code |
| Etichetta / Punto di ritiro / Taglia pacco | label / service point / `ParcelSize` |
| Trasferimento al venditore | transfer |
| Bonifico sull'IBAN del venditore | payout |
| Rimborso | `Refund` |
| Controversia | `Dispute` |
| Contestazione bancaria | chargeback (`PaymentDispute`) |
| Feedback / Valutazioni dettagliate | `Feedback` / detailed seller ratings (`dsr*`) |
| Richiesta di revisione | `FeedbackRevisionRequest` |
| Livello / Venditore Top | `levelKey` / `isTopSeller` |
| Segnalazione / Azione di moderazione / Motivazione | `Report` / `ModerationAction` / statement of reasons |
| Comune, Provincia, Regione | `Comune`, `Provincia`, `Regione` (nomi italiani mantenuti) |
| Dati fiscali | `TaxProfile` |

---

## 19. Dati di seed

### 19.1 Reparti e categorie

Tra parentesi lo slug e la taglia pacco suggerita; **NS** = non spedibile (solo consegna a mano).

1. **Tastiere** (`tastiere`): Pianoforti digitali (`pianoforti-digitali`, XL); Pianoforti acustici (`pianoforti-acustici`, NS); Sintetizzatori (`sintetizzatori`, L); Workstation (`workstation`, XL); Tastiere arranger (`tastiere-arranger`, XL); Master keyboard e controller MIDI (`master-keyboard-controller`, L); Organi (`organi`, NS); Fisarmoniche (`fisarmoniche`, L); Expander e moduli sonori (`expander-moduli-sonori`, M); Accessori per tastiere (`accessori-tastiere`, M).
2. **Chitarre** (`chitarre`): Chitarre elettriche (`chitarre-elettriche`, L); Chitarre acustiche (`chitarre-acustiche`, L); Chitarre classiche (`chitarre-classiche`, L); Semiacustiche e hollow body (`semiacustiche`, L); Amplificatori per chitarra (`amplificatori-chitarra`, XL); Effetti a pedale (`effetti-a-pedale`, S); Multieffetti e modeler (`multieffetti-modeler`, M); Pickup, parti e ricambi (`parti-ricambi-chitarra`, S); Accessori per chitarra (`accessori-chitarra`, S).
3. **Bassi** (`bassi`): Bassi elettrici (`bassi-elettrici`, L); Bassi acustici (`bassi-acustici`, L); Amplificatori per basso (`amplificatori-basso`, XL); Effetti per basso (`effetti-basso`, S); Accessori per basso (`accessori-basso`, S).
4. **Batterie e percussioni** (`batterie-percussioni`): Batterie acustiche (`batterie-acustiche`, NS); Batterie elettroniche (`batterie-elettroniche`, XL); Piatti (`piatti`, M); Rullanti (`rullanti`, L); Hardware e pedali (`hardware-pedali`, M); Percussioni a mano (`percussioni-a-mano`, L); Percussioni orchestrali e a tastiera (`percussioni-orchestrali`, NS); Pelli e accessori (`pelli-accessori`, S).
5. **Strumenti a fiato** (`fiati`): Sassofoni (`sassofoni`, M); Trombe e cornette (`trombe-cornette`, M); Tromboni (`tromboni`, L); Clarinetti (`clarinetti`, M); Flauti traversi (`flauti-traversi`, S); Flauti dolci (`flauti-dolci`, S); Oboi e fagotti (`oboi-fagotti`, M); Corni, tube e flicorni (`corni-tube-flicorni`, XL); Armoniche (`armoniche`, S); Fiati elettronici (`fiati-elettronici`, M); Bocchini e accessori (`bocchini-accessori`, S).
6. **Strumenti a corda e ad arco** (`strumenti-a-corda`): Violini (`violini`, M); Viole (`viole`, M); Violoncelli (`violoncelli`, XL); Contrabbassi (`contrabbassi`, NS); Arpe (`arpe`, NS); Mandolini (`mandolini`, M); Banjo (`banjo`, L); Ukulele (`ukulele`, M); Strumenti tradizionali ed etnici (`strumenti-tradizionali`, L); Archetti, custodie e accessori (`archetti-custodie-accessori`, S).
7. **Home & studio recording** (`recording`): Interfacce audio (`interfacce-audio`, M); Interfacce MIDI (`interfacce-midi`, S); Microfoni (`microfoni`, S); Preamplificatori e channel strip (`preamplificatori`, M); Monitor da studio (`monitor-studio`, L); Cuffie (`cuffie`, S); Outboard ed effetti rack (`outboard`, M); Controller DAW e superfici di controllo (`controller-daw`, M); Registratori portatili (`registratori-portatili`, S).
8. **Live audio** (`live`): Mixer analogici (`mixer-analogici`, M); Mixer digitali (`mixer-digitali`, L); Diffusori attivi (`diffusori-attivi`, XL); Diffusori passivi e subwoofer (`diffusori-passivi-subwoofer`, XL); Finali di potenza (`finali-di-potenza`, L); Impianti PA completi (`impianti-pa`, NS); Monitor da palco e in-ear (`monitor-palco-in-ear`, M); Radiomicrofoni (`radiomicrofoni`, S); Stage box e multicavi (`stage-box-multicavi`, M); Flight case e rack (`flight-case-rack`, XL); Cavi e accessori (`cavi-accessori`, S).
9. **DJ** (`dj`): Console DJ (`console-dj`, XL); Controller DJ (`controller-dj`, L); Giradischi (`giradischi`, L); Media player e lettori CD (`media-player`, M); Mixer DJ (`mixer-dj`, M); Cuffie DJ (`cuffie-dj`, S); Accessori DJ (`accessori-dj`, S).
10. **Luci** (`luci`): Teste mobili (`teste-mobili`, L); Fari PAR e LED (`fari-par-led`, M); Barre LED (`barre-led`, L); Laser (`laser`, M); Effetti luce (`effetti-luce`, M); Macchine del fumo e haze (`macchine-fumo-haze`, M); Controller DMX (`controller-dmx`, M); Strutture e stativi (`strutture-stativi`, NS).
11. **Dischi, CD e didattica** (`dischi-didattica`): Vinili (`vinili`, S); CD (`cd`, S); Musicassette e altri formati (`altri-formati`, S); Spartiti e metodi (`spartiti-metodi`, S); Libri (`libri`, S); Corsi e video didattici (`corsi-video`, S).
12. **Merchandising e collezionismo** (`merchandising`): Abbigliamento (`abbigliamento`, S); Poster e stampe (`poster-stampe`, M); Memorabilia e autografi (`memorabilia-autografi`, M, con avviso sull'autenticità); Oggetti da collezione (`oggetti-collezione`, M).

### 19.2 Attributi principali per categoria

Valori enumerati con etichetta italiana e chiave inglese in `kebab-case`. Completa con buon senso le categorie non elencate.

| Categorie | Attributi (chiave: tipo [valori]) |
|---|---|
| Chitarre elettriche | `bodyShape`: ENUM [tipo Strat, tipo Tele, single cut, double cut, offset, superstrat, forme particolari, altro]; `pickupConfig`: ENUM [SSS, HSS, HH, HSH, P90, altro]; `electronics`: ENUM [passiva, attiva]; `strings`: ENUM [6, 7, 8, 12]; `bridge`: ENUM [fisso, tremolo vintage, tremolo a due perni, a bloccaggio, Bigsby]; `leftHanded`: BOOLEAN; `caseIncluded`: ENUM [nessuna, borsa, custodia rigida]; `madeIn`: ENUM [USA, Messico, Giappone, Corea, Cina, Indonesia, Europa, altro] |
| Chitarre acustiche | `bodyShape`: ENUM [dreadnought, jumbo, auditorium/OM, concert, parlor, travel]; `top`: ENUM [massello, laminato]; `electroAcoustic`, `cutaway`, `leftHanded`: BOOLEAN; `strings`: ENUM [6, 12]; `caseIncluded` |
| Chitarre classiche | `size`: ENUM [4/4, 7/8, 3/4, 1/2]; `top`; `electroAcoustic`; `cutaway`; `caseIncluded` |
| Bassi elettrici | `strings`: ENUM [4, 5, 6]; `fretless`: BOOLEAN; `electronics`; `scaleLength`: ENUM [long, medium, short]; `leftHanded`; `caseIncluded` |
| Amplificatori (chitarra e basso) | `ampFormat`: ENUM [combo, testata, cassa]; `technology`: ENUM [valvolare, transistor, ibrido, modeling]; `powerWatts`: NUMBER (W); `speakerConfig`: ENUM [1x8, 1x10, 1x12, 2x10, 2x12, 4x10, 4x12, 1x15, altro]; `footswitchIncluded`: BOOLEAN |
| Effetti a pedale e per basso | `effectType`: ENUM [overdrive/distorsione, fuzz, delay, riverbero, modulazione, wah, compressore, looper, accordatore, EQ, booster, multi, altro]; `power`: ENUM [9V, 18V, batteria, altro]; `trueBypass`: BOOLEAN |
| Tastiere (pianoforti digitali, synth, workstation, master) | `keys`: ENUM [25, 37, 49, 61, 73, 76, 88]; `action`: ENUM [synth, semipesata, pesata, a martelletti]; `engine` (synth): ENUM [analogico, digitale, virtual analog, ibrido, campionamento]; `polyphony`: NUMBER; `aftertouch`: BOOLEAN; `cabinet` (piani digitali): ENUM [portatile, a mobile] |
| Batterie acustiche / elettroniche | `pieces`: NUMBER; `shellMaterial`: ENUM [acero, betulla, mogano, pioppo, altro]; `hardwareIncluded`, `cymbalsIncluded`: BOOLEAN; `meshHeads` (elettroniche): BOOLEAN |
| Piatti | `cymbalType`: ENUM [ride, crash, hi-hat, splash, china, effetto, set]; `diameterInches`: NUMBER |
| Fiati | `key`: ENUM [Sib, Mib, Do, Fa, La]; `level`: ENUM [studente, intermedio, professionale]; `finish`: ENUM [laccato, argentato, dorato, altro] |
| Archi | `size`: ENUM [4/4, 3/4, 1/2, 1/4, 1/8]; `bowIncluded`, `caseIncluded`: BOOLEAN |
| Interfacce audio | `inputs`, `outputs`: NUMBER; `connection`: ENUM [USB, Thunderbolt, PCIe, rete] |
| Microfoni | `micType`: ENUM [dinamico, condensatore, nastro]; `polarPattern`: ENUM [cardioide, supercardioide, omnidirezionale, figura a 8, multipattern] |
| Diffusori e finali | `powerWatts`: NUMBER; `wooferInches`: NUMBER |
| Mixer | `channels`: NUMBER; `usbAudio`: BOOLEAN |
| Dischi | `format`: ENUM [LP 12", 7", 10", CD, cassetta]; `mediaGrade`: ENUM [M, NM, VG+, VG, G+, G, F/P]; `genre`: TEXT |

### 19.3 Marche (nomi usati solo come dati descrittivi; nessun logo)

Fender, Squier, Gibson, Epiphone, Ibanez, PRS, ESP, LTD, Jackson, Charvel, Schecter, Gretsch, Rickenbacker, Yamaha, Taylor, Martin Guitar, Takamine, Cort, Eko, Harley Benton, Ernie Ball Music Man, Sterling by Music Man, G&L, Höfner, Warwick, Spector, Sire, Marshall, Vox, Orange, Mesa/Boogie, Peavey, Blackstar, Boss, Line 6, Kemper, Neural DSP, Fractal Audio, Positive Grid, Ampeg, Markbass, Electro-Harmonix, MXR, Dunlop, TC Electronic, Strymon, Eventide, Walrus Audio, Roland, Korg, Nord, Moog, Arturia, Novation, Native Instruments, Akai Professional, Kawai, Casio, Behringer, Elektron, Sequential, Waldorf, Hammond, Viscount, Ketron, Farfisa, Pearl, Tama, DW, Ludwig, Sonor, Mapex, Zildjian, Sabian, Meinl, Paiste, UFIP, Evans, Remo, Selmer, Yanagisawa, Buffet Crampon, Vincent Bach, Jupiter, Stentor, Gewa, Shure, Sennheiser, Neumann, AKG, Rode, Audio-Technica, Focusrite, Universal Audio, RME, MOTU, PreSonus, Steinberg, Allen & Heath, Soundcraft, Mackie, QSC, RCF, FBT, dB Technologies, JBL, Electro-Voice, Bose, KRK, Adam Audio, Genelec, Pioneer DJ, AlphaTheta, Denon DJ, Rane, Technics, Reloop, Chauvet DJ, ADJ, Martin Professional. Con alias (es. "Music Man" → Ernie Ball Music Man).

### 19.4 Condizioni

| Valore | Etichetta | Spiegazione nel form |
|---|---|---|
| `NEW` | Nuovo | Mai usato, imballo originale |
| `LIKE_NEW` | Come nuovo | Usato pochissimo, nessun segno visibile |
| `EXCELLENT` | Ottime condizioni | Lievi segni d'uso, perfettamente funzionante |
| `GOOD` | Buone condizioni | Segni d'uso evidenti, funzionante |
| `FAIR` | Discrete condizioni | Usura marcata o piccoli difetti descritti nell'annuncio |
| `FOR_PARTS` | Da riparare / per ricambi | Non funzionante o con difetti importanti |

### 19.5 Festività nazionali (per i giorni lavorativi)

Fisse: 1 gennaio, 6 gennaio, 25 aprile, 1 maggio, 2 giugno, 15 agosto, **4 ottobre** (San Francesco d'Assisi, di nuovo festa nazionale dal 2026, legge 151/2025), 1 novembre, 8 dicembre, 25 e 26 dicembre. Mobile: Lunedì dell'Angelo, calcolato dalla data di Pasqua (algoritmo di Meeus/Jones/Butcher). Il seed popola l'anno corrente e i due successivi; la tabella `Holiday` è modificabile da admin.

### 19.6 Dati demo (solo sviluppo)

60 utenti (10 negozi, 1 amministratore, 1 moderatore, 1 operatore di supporto), 2.000 annunci distribuiti su categorie e regioni, immagini segnaposto generate con sharp (sfumatura + nome della categoria; nessuna immagine presa dal web), conversazioni, offerte, almeno 2 ordini per ogni stato, feedback con distribuzione realistica (circa 97% positivi), 2 controversie aperte, 3 segnalazioni. Credenziali demo elencate nel README e utilizzabili solo in sviluppo.

---

## 20. Definition of Done finale e riferimenti

### 20.1 Checklist di consegna

- [ ] Fasi 0–12 completate con i criteri di accettazione verificati.
- [ ] Su una macchina pulita bastano `pnpm install && pnpm infra:up && pnpm db:reset && pnpm db:seed:demo && pnpm dev` (documentato nel README).
- [ ] CI verde: lint, typecheck, unit, integrazione, e2e J1–J8, controlli di sicurezza.
- [ ] Copertura: `packages/domain` ≥ 95%, service dell'API ≥ 80%.
- [ ] Nessun segreto nel repository (gitleaks pulito).
- [ ] OpenAPI disponibile in sviluppo; SDK tipizzato usato dal web.
- [ ] Documentazione: `ARCHITECTURE.md` (con diagrammi), `DECISIONS.md` (ADR), `PAYMENTS.md` (flussi, ledger, politiche), `FEEDBACK.md` (regole), `SECURITY.md` (threat model e checklist), `COMPLIANCE.md` (stato di ogni voce del §14, "da validare"), `RUNBOOK.md`, `DATA_SOURCES.md`, `PROGRESS.md`.
- [ ] Accessibilità: zero violazioni axe serie o critiche sulle pagine chiave; dichiarazione di accessibilità pubblicata.
- [ ] Budget di prestazioni rispettati.
- [ ] Testi legali chiaramente marcati come segnaposto.
- [ ] Elenco per l'utente "prima del lancio": attivazione Stripe live e approvazione del modello di business; contratto con il provider di spedizioni; dominio e DNS email (SPF, DKIM, DMARC); revisione di avvocato e commercialista; DPA firmati; banner cookie configurato; test di ripristino dei backup eseguito.

### 20.2 Riferimenti utili

- Stripe, separate charges and transfers: https://docs.stripe.com/connect/marketplace/tasks/accept-payment/separate-charges-and-transfers
- Stripe, pagamenti manuali e limiti di trattenuta dei fondi: https://docs.stripe.com/connect/manual-payouts
- Stripe, costruire un marketplace (Accounts v2): https://docs.stripe.com/connect/marketplace
- Stripe, configurazioni consigliate per Connect: https://docs.stripe.com/connect/integration-recommendations
- Stripe, Satispay: https://docs.stripe.com/payments/satispay
- Prisma 7, configurazione del datasource e del client: https://pris.ly/d/config-datasource e https://pris.ly/d/prisma7-client-config
- Better Auth, integrazione NestJS: https://better-auth.com/docs/integrations/nestjs
- Next.js, release e avvisi di sicurezza: https://nextjs.org/blog
- NestJS: https://docs.nestjs.com
- Meilisearch: https://www.meilisearch.com/docs
- Sendcloud Shipping API: https://www.sendcloud.com/it/shipping-api/ — ShippyPro: https://www.shippypro.com
- Digital Services Act (Reg. UE 2022/2065): https://eur-lex.europa.eu/eli/reg/2022/2065/oj
