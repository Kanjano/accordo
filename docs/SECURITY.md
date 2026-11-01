# Sicurezza

Obiettivo: OWASP ASVS livello 2 e Top 10 (SPEC §13). Documento aggiornato a ogni fase; revisione completa in Fase 12.

## Threat model sintetico (STRIDE) — stato Fase 12

| Minaccia               | Esempio                                                                 | Contromisure attive                                                                                                                                                                                                                                                              |
| ---------------------- | ----------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Spoofing               | furto di credenziali via phishing, sito clone che conferma la ricezione | hash scrypt (Better Auth); 2FA TOTP e passkey; email di nuovo dispositivo con "Non sono stato io" (revoca tutte le sessioni, invalida la password, manda il reset); step-up con codice email sui dispositivi nuovi; step-up sulla conferma di ricezione e sul codice di consegna |
| Tampering              | CSRF, XSS, manomissione dei webhook                                     | cookie `HttpOnly` `SameSite=Lax`; controllo `Origin`; CSP con nonce e `strict-dynamic`; testi mostrati come testo semplice; firma dei webhook sul corpo grezzo; ordini modificati solo dalla macchina a stati con lock ottimistico                                               |
| Repudiation            | negare un'azione sensibile                                              | `AuditLog` append-only nel database (trigger, e ruolo applicativo senza UPDATE/DELETE); sessioni con IP e user agent; motivazioni scritte di ogni provvedimento                                                                                                                  |
| Information disclosure | IDOR, enumerazione account, fuga di dati fiscali                        | query filtrate per proprietario (404 uniforme); reset password con risposta identica; dati fiscali cifrati per campo (AES-256-GCM); log con redazione; etichette e prove servite solo alle parti (`no-store`)                                                                    |
| Denial of service      | brute force, scraping                                                   | limiti su Valkey per IP e per account; Turnstile; limiti per gli account nuovi; ricerca anonima a 60/min per IP                                                                                                                                                                  |
| Elevation of privilege | staff senza 2FA, impersonificazione abusata, SQL con il ruolo sbagliato | 2FA obbligatoria per ogni route `admin/*` e Bull Board; step-up su sanzioni, impostazioni, export, rimborsi; impersonificazione in sola lettura e auditata; ruolo database applicativo non superuser                                                                             |

## Checklist SPEC §13 (stato)

**Account (§13.3)**
- [x] Hash delle password gestito da Better Auth.
- [x] Dispositivi riconosciuti (cookie firmato, hash in `KnownDevice`) ed email di avviso; "Non sono stato io" revoca le sessioni, invalida la password e manda il link di reset (token firmato valido 7 giorni, conferma con un clic su una pagina, per evitare che gli scanner email lo attivino).
- [x] Step-up: ri-autenticazione oltre 10 minuti, codice email se il dispositivo è nuovo da meno di 24 ore.
- [x] Il cambio password revoca le altre sessioni; elenco delle sessioni con revoca.
- [x] 2FA obbligatoria per lo staff, suggerita ai venditori.

**Rate limit (§13.2), verificati in Fase 12**

| Azione              | Limite                                                                     | Dove                                                                     |
| ------------------- | -------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| Login               | 5/min per IP e 10/ora per account, poi Turnstile (senza Turnstile: attesa) | Better Auth + hook `before` (`login-account:*`), test `hardening.int.ts` |
| Registrazione       | 3/ora per IP + Turnstile                                                   | Better Auth                                                              |
| Reset password      | 3/ora per IP + Turnstile                                                   | Better Auth                                                              |
| Verifica 2FA        | 5/min per IP                                                               | Better Auth                                                              |
| Nuove conversazioni | 30/giorno (10 per account < 7 giorni)                                      | `RateLimitService`                                                       |
| Messaggi            | 30/min per utente                                                          | `RateLimitService`                                                       |
| Offerte             | 20/giorno per utente                                                       | `RateLimitService`                                                       |
| Creazione annunci   | 20/giorno (5 per account < 7 giorni)                                       | `RateLimitService`                                                       |
| Segnalazioni        | 10/giorno per utente o IP + Turnstile per gli anonimi                      | `RateLimitService`                                                       |
| Codice di consegna  | 5 tentativi per ordine, poi blocco di 1 ora                                | dominio `handover`                                                       |
| Ricerca anonima     | 60/min per IP (suggerimenti 120/min)                                       | `RateLimitService`                                                       |

`RATE_LIMIT_ENABLED=false` solo per e2e e test di carico, mai in staging o produzione.

**Chat e annunci (§13.4–13.5)**
- [x] `scanMessage` (link non cliccabili, contatti mascherati, IBAN e parole a rischio con avviso, 5 messaggi segnalati in 24 ore → `LIMITED`).
- [x] Controlli sugli annunci: parole vietate, prezzo anomalo, foto riutilizzate (dHash ≤ 6), venditori nuovi sopra 2.000 €, limiti per gli account nuovi.

**Piattaforma (§13.6)**
- [x] Header di sicurezza:
  - **web:** CSP con nonce per richiesta (`proxy.ts`), `strict-dynamic`, `frame-ancestors 'none'`, `object-src 'none'`, `base-uri 'self'`, `form-action 'self'` e `upgrade-insecure-requests` in HTTPS; poi HSTS (2 anni), `X-Content-Type-Options`, `Referrer-Policy: strict-origin-when-cross-origin`, `X-Frame-Options: DENY` e una `Permissions-Policy` minima;
  - **API:** `default-src 'none'`, gli stessi header e HSTS.
- [x] Validazione Zod di ogni input; descrizioni e messaggi come testo semplice.
- [x] Upload: tipi e dimensioni limitati, magic bytes, ricodifica con sharp.
- [x] Autorizzazione per risorsa con test anti-IDOR.
- [x] **Database:** in produzione `accordo_app` non è superuser e non ha UPDATE/DELETE/TRUNCATE su `AuditLog`; `accordo_migrator` possiede lo schema ed esegue le migrazioni; la pulizia oltre 2 anni passa da `purge_audit_log()` (SECURITY DEFINER), con il trigger append-only come seconda barriera. Verificato sullo stack del compose di produzione.
- [x] Webhook firmati sul corpo grezzo; nessuna chiamata server a URL forniti dagli utenti.
- [x] Log pino con redazione di cookie, `Authorization`, `set-cookie` e password; i dati fiscali non arrivano mai nei log né nell'audit; i dati delle carte non passano dai nostri server.
- [x] Supply chain:
  - in CI: `pnpm audit --prod --audit-level high`, gitleaks su tutta la storia, CodeQL (`security-extended`);
  - Renovate con età minima di 14 giorni;
  - versioni esatte, `allowBuilds` esplicito.
- [x] Admin: 2FA, step-up su rimborsi, sanzioni, impostazioni ed export, audit di ogni azione. L'allowlist IP facoltativa si configura in Caddy (`remote_ip` su `api.<dominio>/api/v1/admin/*` e `/admin/queues`) se serve.

**Minacce §13.7**
- [x] Collusione: niente ordini tra account che hanno usato lo stesso browser (`ORDER_LINKED_ACCOUNTS`). Gli IP condivisi non bloccano, perché con il CGNAT dei gestori mobili ci sarebbero troppi falsi positivi. L'impronta della carta si aggiunge con Stripe live (Radar, sotto).
- [x] Carta rubata: 3DS e Radar (da configurare), limiti per gli account nuovi, solo indirizzi italiani.

**Proxy e IP del client:** Caddy sostituisce `X-Forwarded-For` con l'IP reale (non si fida degli header in arrivo), l'API usa `trust proxy = 1`, e il web inoltra l'header nelle chiamate SSR dirette all'API.

## Rischi residui noti

- `pnpm audit`: `deepmerge` (severità bassa, nessuna patch), dipendenza di `html-to-text` usata dal rendering delle email con opzioni statiche. Nessun input utente raggiunge `mergeObject`.
- La rotazione di `ENCRYPTION_KEY` richiede ancora il supporto a più chiavi (`docs/RUNBOOK.md`).
- Adapter Stripe e Sendcloud non ancora provati con account reali (ADR-0037, ADR-0041).
- Penetration test esterno da fare prima del lancio.

## Regole Radar (pagamenti, SPEC §6.11)

Da configurare nella Dashboard Stripe (Radar for Platforms) quando l'account sarà attivo:

- `Block if :cvc_check: = 'fail'` e `Block if :address_zip_check: = 'fail'` (quando disponibile).
- `Request 3D Secure if :amount_in_eur: > 500`; `Request 3D Secure if :risk_level: = 'elevated'`; `Block if :risk_level: = 'highest'`.
- Velocità: `Block if :total_charges_per_card_number_hourly: > 3`, `Review if :total_charges_per_email_daily: > 5`.
- Paese: `Review if :card_country: != 'IT' and :ip_country: != :card_country:`.
- Collusione: confrontare `:card_fingerprint:` con le carte usate dal venditore (metadati dell'ordine) quando Stripe è live.
- Già applicati nell'API: account < 7 giorni max 3 ordini in 24 h; account collegati allo stesso dispositivo bloccati; conferma di ricezione e codice di consegna solo con step-up; solo indirizzi in Italia.
