# Conformità (Italia/UE)

Stato delle voci del SPEC §14. Tutto **da validare** con legale e commercialista.

| Voce                                | Stato                                                                                                                                                                                                                                  |
| ----------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Banner cookie (linee guida Garante) | Fatto: Accetta/Rifiuta equivalenti, X = rifiuto, scelte granulari non preselezionate, validità 6 mesi, registro dei consensi in `AuditLog`.                                                                                            |
| Analytics                           | Caricati solo dopo il consenso (verificato da e2e). Strumento da scegliere (Plausible/Umami self-hosted UE).                                                                                                                           |
| Consenso marketing                  | Separato e facoltativo alla registrazione, modificabile nel profilo (`marketingConsentAt`).                                                                                                                                            |
| Accettazione termini                | Obbligatoria, con timestamp (`termsAcceptedAt`).                                                                                                                                                                                       |
| Diritti GDPR                        | Export JSON completo (step-up) e cancellazione con anonimizzazione (bloccata con ordini aperti). Rettifica dal profilo (ADR-0048).                                                                                                     |
| Testi legali                        | Segnaposto MDX marcati "DA VALIDARE CON IL LEGALE".                                                                                                                                                                                    |
| Attribuzione dati ISTAT (CC BY 4.0) | Presente in Note legali.                                                                                                                                                                                                               |
| Professionista / privato (§14.3)    | Fatto: "Venditore professionale" con ragione sociale, P.IVA, REA, sede e contatti sugli annunci dei negozi; avviso sui diritti UE non applicabili sugli annunci dei privati.                                                           |
| Ribassi dei negozi (Omnibus)        | Fatto: prezzo più basso dei 30 giorni precedenti il ribasso, usato anche come riferimento della percentuale (ADR-0045).                                                                                                                |
| Parametri di classificazione        | Fatto: `/parametri-di-classificazione` (testo da validare).                                                                                                                                                                            |
| Informazioni B2C dei negozi         | Fatto: politica resi e garanzia obbligatorie, recesso 14 giorni e garanzia legale spiegati su annuncio e vetrina.                                                                                                                      |
| Tracciabilità operatori (DSA)       | Fatto: dati del negozio, autocertificazione con timestamp, verifica manuale dello staff con motivazione, segnalazioni e ricorsi.                                                                                                       |
| DSA notice & action                 | Fatto: modulo pubblico con Turnstile (anche senza account), conferma di ricezione, decisione motivata a chi segnala e all'interessato, ricorso interno con revisore diverso, statistiche nel backoffice (ADR-0046). Testi da validare. |
| DAC7                                | Fatto: periodi trimestrali, soglie e solleciti, `TaxProfile` cifrato, export CSV. Da confermare: calcolo del corrispettivo, vendite fuori piattaforma, blocco degli incassi (disattivato), tracciato AdE (ADR-0047).                   |

## Conservazione dei dati (valori da confermare)

Applicata ogni notte dal job `retention` (impostazione `retention`, ADR-0048).

Ordini e dati contabili 10 anni; dati DAC7 per il periodo di legge; messaggi 24 mesi dall'ultima attività salvo controversie; log applicativi 90 giorni; audit log almeno 2 anni; account eliminati anonimizzati subito (obiettivo: entro 30 giorni).
