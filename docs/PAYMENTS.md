# Pagamento protetto

Specifica: SPEC §6. Decisioni: ADR-0037…0043. Qui: come funziona nel codice, dove intervenire, cosa resta da validare.

> Non è un "escrow": la piattaforma non custodisce denaro su conti propri. I fondi passano da Stripe (Connect, _separate charges and transfers_) e il trasferimento al venditore parte solo quando l'ordine è completato. Nei testi: "Pagamento protetto" / "Protezione acquisti".

## Componenti

| Dove                                         | Cosa                                                                                              |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `packages/domain/src/amounts.ts`             | `computeOrderAmounts()`: importi in centesimi, basis point, arrotondamento half-up                |
| `packages/domain/src/order-state-machine.ts` | macchina a stati pura (§6.4), test per ogni transizione e per quelle vietate                      |
| `packages/domain/src/ledger.ts`              | scritture in partita doppia per ogni evento, sempre bilanciate                                    |
| `packages/orders`                            | `applyOrderEvent` (unico punto che cambia lo stato), `applyDisputeAction`, `runDueAction` (timer) |
| `packages/payments`                          | porta `PaymentProvider` con adapter `fake` (sviluppo e test) e `stripe`                           |
| `apps/api/src/modules/orders`                | checkout con `Idempotency-Key`, azioni delle parti, webhook, admin                                |
| `apps/worker/src/payments`                   | effetti esterni (trasferimenti, rimborsi, annullamenti), sweeper dei timer, controllo notturno    |

Regola d'oro: lo stato di un ordine cambia **solo** con `applyOrderEvent` (`OrdersService.transition()` nell'API, sweeper e webhook nel worker), con lock ottimistico su `version`. Gli effetti esterni sono righe outbox `order.effects` scritte nella stessa transazione ed eseguite dal worker con chiavi idempotenti.

## Importi

```text
buyerFee    = clamp(round(prezzo × 4%) + 0,50 €, min 1,00 €, max 25,00 €)   # IVA inclusa
buyerFeeVat = round(buyerFee × 22 / 122)
totale      = prezzo + spedizione + buyerFee
sellerNet   = prezzo − commissione venditore (0 nell'MVP) + spedizione autonoma
```

I valori stanno in `PlatformSetting.fees` (modificabili da `/admin/impostazioni`) e vengono "fotografati" sull'ordine al checkout.

## Flusso

1. **Checkout** (`POST /api/v1/orders`): controlli (annuncio attivo, non proprio, email verificata, account non limitato, al massimo 3 ordini in 24 ore per gli account con meno di 7 giorni, nessun account collegato allo stesso dispositivo), importi, ordine `CHECKOUT_PENDING` con prenotazione di 15 minuti, PaymentIntent con `transfer_group`. Un solo ordine attivo per annuncio (indice unico parziale): con due acquisti concorrenti uno solo passa.
2. **Webhook** `payment_intent.succeeded`: firma sul corpo grezzo, `WebhookEvent` deduplicato, poi `PAYMENT_SUCCEEDED` → `PAID` (spedizione) o `HANDOVER_PENDING` (consegna a mano), ledger del pagamento, annuncio `RESERVED`, etichetta se la spedizione è integrata.
3. **Consegna:** tracking (`SHIPPED` → `DELIVERED`, poi 72 ore di verifica) oppure codice di 6 cifre per la consegna a mano (HMAC con pepper, 5 tentativi, poi blocco di 1 ora).
4. **Completamento:** conferma dell'acquirente con step-up, chiusura automatica o codice verificato → `COMPLETED`, trasferimento con `source_transaction`, feedback aperti.

Timer (`Order.nextAction`/`nextActionAt`, sweeper ogni minuto): prenotazione, promemoria e termine di spedizione (5 giorni lavorativi), consegna a mano (7 giorni), chiusura automatica, scadenze delle controversie e dei resi. I giorni lavorativi escludono le festività nazionali (`Holiday`).

## Ledger

| Evento                                    | DEBIT                    | CREDIT                                                                        |
| ----------------------------------------- | ------------------------ | ----------------------------------------------------------------------------- |
| Pagamento                                 | `CASH_STRIPE`            | `SELLER_PAYABLE`, `SHIPPING_PAYABLE`, `PLATFORM_FEE_REVENUE`, `VAT_PAYABLE`   |
| Commissioni Stripe                        | `PAYMENT_PROCESSOR_FEES` | `CASH_STRIPE`                                                                 |
| Trasferimento                             | `SELLER_PAYABLE`         | `CASH_STRIPE`                                                                 |
| Rimborso parziale                         | `SELLER_PAYABLE`         | `CASH_STRIPE`                                                                 |
| Rimborso dopo il trasferimento            | `SELLER_RECEIVABLE`      | `CASH_STRIPE`; saldato dallo storno o compensato sul trasferimento successivo |
| Chargeback perso con protezione venditore | `CHARGEBACK_LOSSES`      | `CASH_STRIPE`                                                                 |

`externalRef` univoco su ogni transazione (niente doppie registrazioni). Controllo notturno alle 03:30: transazioni sbilanciate, ordini chiusi con `SELLER_PAYABLE` ≠ 0, fondi trattenuti oltre 60 giorni (alert) e 85 giorni (azione obbligatoria, limite Stripe 90).

## Politiche (configurabili, da validare)

- **Annullamento** per colpa del venditore o per termine scaduto: rimborso totale, +1 cancellazione al venditore, etichetta addebitata se non annullabile (`PlatformSetting.refundPolicy`).
- **Annullamento concordato** o consegna a mano non avvenuta: rimborso totale, nessuna penalità.
- **Controversie** (§6.6, `packages/domain/src/disputes.ts`): 72 ore al venditore, 72 ore all'acquirente per rispondere a una proposta parziale, poi il supporto. Esiti: rimborso totale, con reso, parziale (al massimo il prezzo dell'oggetto) o pagamento al venditore. Ricorso entro 7 giorni, esaminato da un altro membro dello staff.
- **Chargeback**: trasferimento sospeso e prove inviate automaticamente; con la protezione venditore (spedizione tracciata consegnata o codice verificato) la perdita resta alla piattaforma.
- **DAC7**: blocco facoltativo dei trasferimenti ai venditori senza dati fiscali (`dac7.blockPayoutsWithoutProfile`, spento).

## Sviluppo e test

- `PAYMENT_PROVIDER=fake`: nessuna rete. Il checkout mostra "Paga (simulazione)" e gli eventi passano dal vero endpoint webhook, firmati. Endpoint di sviluppo (404 in produzione): `/api/v1/dev/orders/:id/payment`, `/run-timer`, `/chargeback`, `/dev/payments/onboarding-complete`.
- `PAYMENT_PROVIDER=stripe`: chiavi test e `pnpm stripe:listen`.
- Test: unità del dominio (copertura ≥ 95%); integrazione dell'API e del worker (webhook duplicati, concorrenza, idempotenza, rimborsi, chargeback, ledger bilanciato); e2e J2, J3, J4, J5, J8.

## Prima del lancio

- Descrivere a Stripe il modello di business (fondi trattenuti fino alla conferma) e ottenere l'approvazione del caso d'uso.
- Provare l'adapter `stripe` con un account test: onboarding Accounts v2, Payment Element con 3DS (`4000 0027 6000 3184`), trasferimento visibile nella Dashboard, chargeback (`4000 0000 0000 0259`), confronto notturno con le _balance transaction_.
- Configurare le regole Radar (`docs/SECURITY.md`).
- Validare con il commercialista: IVA inclusa nella commissione dell'acquirente, trattamento delle spedizioni, politiche di rimborso.
