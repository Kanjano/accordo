# Feedback e reputazione

Specifica: SPEC §8. Decisioni: ADR-0012, ADR-0044. Pagina pubblica: `/come-funzionano-i-feedback`.

## Regole

- Solo le parti di un ordine **completato** e pagato sulla piattaforma; un feedback per ruolo per ordine; entro 60 giorni dal completamento (promemoria al giorno 3 e al giorno 30).
- **Acquirente → venditore:** positivo, neutro o negativo; commento obbligatorio per neutro e negativo (20–500 caratteri); quattro valutazioni da 1 a 5 (descrizione, comunicazione, tempi di spedizione, imballaggio; gli ultimi due non per la consegna a mano).
- **Venditore → acquirente:** solo positivo, vincolato anche nel database.
- **Risposta:** una per feedback ricevuto, al massimo 500 caratteri.
- **Richiesta di revisione** di un neutro o negativo ricevuto da meno di 30 giorni: una per ordine, 5 all'anno più 5 ogni 1.000 feedback degli ultimi 12 mesi. L'acquirente ha 10 giorni; la revisione può solo migliorare il giudizio e il valore precedente resta salvato.

## Calcoli (`packages/domain/src/reputation.ts`)

- **Conteggiabile:** pubblicato, ordine ≥ 3 € (`FEEDBACK_MIN_ORDER_CENTS`), primo del gruppo (autore, destinatario, ruolo, settimana ISO del completamento). Gli altri restano visibili ma non contano.
- **Punteggio** a vita: +1 per ogni positivo, −1 per ogni negativo (come venditore e come acquirente).
- **Percentuale di positivi** come venditore negli ultimi 12 mesi, neutri esclusi, con un decimale.
- **Valutazioni dettagliate:** media a 12 mesi, mostrata con almeno 5 voti.
- **Livelli:** Esordiente (10), Turnista (50), Solista (100), Professionista (500), Maestro (1.000), Leggenda (5.000).
- **Venditore Top** (ogni notte): 90 giorni di anzianità e identità verificata, ≥ 20 vendite e ≥ 1.000 €, ≥ 98% positivi, media ≥ 4,7 con almeno 10 voti, controversie perse ≤ 1% (o al massimo 1 sotto le 100 vendite), cancellazioni ≤ 2%, nessuna sanzione.
- **Indicatori:** tempo di risposta mediano e tasso di risposta entro 24 ore (conversazioni degli ultimi 30 giorni).

Solo `recomputeReputation` (`packages/orders`) scrive `UserReputation`: ricostruisce tutto dalle righe di origine ed è idempotente. La chiamano gli eventi `feedback.*` e il completamento degli ordini (coda `reputation`) e il ricalcolo notturno delle 04:00. Quando cambiano percentuale, livello o badge, gli annunci del venditore vengono reindicizzati.

## Moderazione e anti-manipolazione

- Controlli automatici prima della pubblicazione: contatti, link, IBAN, dati personali, insulti (`PlatformSetting.feedbackInsults`). Se scattano, il feedback va in `HIDDEN` finché lo staff non lo pubblica o lo rimuove.
- Rimozione con motivo codificato (`OFFENSIVE`, `PERSONAL_DATA`, `CONTACT_OR_LINKS`, `EXTORTION`, `UNRELATED`, `ILLEGAL`, `AUTHOR_BANNED_FOR_FRAUD`, `DISPUTE_ABUSE`): crea una `ModerationAction`, notifica entrambe le parti ed è contestabile con ricorso.
- Pulsante "Segnala estorsione" sui feedback.
- **Collusione:**
  - i feedback tra coppie con più di 3 ordini reciproci in 30 giorni non contano finché il segnale resta;
  - gli account che hanno usato lo stesso browser non possono comprare l'uno dall'altro (`ORDER_LINKED_ACCOUNTS`, Fase 12), quindi non possono scambiarsi feedback.

## Test

Unità: deduplicazione per settimana, finestra di 12 mesi, neutri esclusi, soglia minima, revisione e rimozione, venditore solo positivo, finestra di 60 giorni, quote delle revisioni, livelli, Venditore Top, consegna a mano senza valutazioni di spedizione. Integrazione dell'API e del worker; e2e "feedback e reputazione aggiornata".
