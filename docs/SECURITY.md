# Sicurezza

Obiettivo: OWASP ASVS livello 2 e Top 10 (SPEC §13). Documento aggiornato a ogni fase.

## Threat model sintetico (STRIDE) — stato Fase 2

| Minaccia               | Esempio                                     | Contromisure attive                                                                                                                                                                              |
| ---------------------- | ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Spoofing               | furto di credenziali via phishing           | hash scrypt (Better Auth), 2FA TOTP e passkey, avviso email di nuovo dispositivo, step-up con codice email sui dispositivi nuovi                                                                 |
| Tampering              | CSRF su richieste di modifica               | cookie `HttpOnly`, `SameSite=Lax`, controllo `Origin` sulle richieste non sicure (API e Better Auth)                                                                                             |
| Repudiation            | negare un'azione sensibile                  | `AuditLog` (eliminazione account, consensi); sessioni con IP e user agent                                                                                                                        |
| Information disclosure | IDOR, enumerazione account                  | query sempre filtrate per proprietario (404 uniforme), reset password con risposta identica, profilo pubblico senza indirizzo né telefono, log con redazione di cookie, Authorization e password |
| Denial of service      | brute force su login e 2FA                  | limiti per IP su Valkey, Turnstile su registrazione e reset, 5 tentativi per codice email                                                                                                        |
| Elevation of privilege | staff senza 2FA, impersonificazione abusata | ruoli verificati dal guard, 2FA obbligatoria per lo staff, sessioni impersonificate in sola lettura                                                                                              |

## Checklist (stato)

- [x] Segreti solo in `.env` (ignorato), `.env.example` senza valori reali.
- [x] Errori in Problem Details senza dettagli interni (500 generico).
- [x] Validazione Zod di ogni input dell'API.
- [ ] CSP con nonce e header di sicurezza (Fase 12).
- [ ] Limite di login per account, revisione dei limiti (Fase 12).
- [ ] gitleaks, CodeQL, `pnpm audit` in CI (Fase 12).

## Regole Radar (pagamenti, SPEC §6.11)

Da configurare nella Dashboard Stripe (Radar for Platforms) quando l'account sarà attivo:

- `Block if :cvc_check: = 'fail'` e `Block if :address_zip_check: = 'fail'` (quando disponibile).
- `Request 3D Secure if :amount_in_eur: > 500`; `Request 3D Secure if :risk_level: = 'elevated'`; `Block if :risk_level: = 'highest'`.
- Velocità: `Block if :total_charges_per_card_number_hourly: > 3`, `Review if :total_charges_per_email_daily: > 5`.
- Paese: `Review if :card_country: != 'IT' and :ip_country: != :card_country:`.
- Collusione (lato piattaforma, Fase 12): blocco degli ordini tra account che condividono dispositivo, IP o impronta della carta (`:card_fingerprint:` nei metadati dell'ordine).
- Già applicati nell'API: account < 7 giorni max 3 ordini in 24 h; conferma di ricezione e codice di consegna solo con step-up; solo indirizzi in Italia.
