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
