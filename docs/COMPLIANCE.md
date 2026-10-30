# Conformità (Italia/UE)

Stato delle voci del SPEC §14. Tutto **da validare** con legale e commercialista.

| Voce                                | Stato                                                                                                                                       |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| Banner cookie (linee guida Garante) | Fatto: Accetta/Rifiuta equivalenti, X = rifiuto, scelte granulari non preselezionate, validità 6 mesi, registro dei consensi in `AuditLog`. |
| Analytics                           | Caricati solo dopo il consenso (verificato da e2e). Strumento da scegliere (Plausible/Umami self-hosted UE).                                |
| Consenso marketing                  | Separato e facoltativo alla registrazione, modificabile nel profilo (`marketingConsentAt`).                                                 |
| Accettazione termini                | Obbligatoria, con timestamp (`termsAcceptedAt`).                                                                                            |
| Diritti GDPR                        | Cancellazione con anonimizzazione attiva (bloccata con ordini aperti). Export: Fase 11.                                                     |
| Testi legali                        | Segnaposto MDX marcati "DA VALIDARE CON IL LEGALE".                                                                                         |
| Attribuzione dati ISTAT (CC BY 4.0) | Presente in Note legali.                                                                                                                    |
| DSA, DAC7, Omnibus                  | Fasi 10–11.                                                                                                                                 |

## Conservazione dei dati (valori da confermare)

Ordini e dati contabili 10 anni; dati DAC7 per il periodo di legge; messaggi 24 mesi dall'ultima attività salvo controversie; log applicativi 90 giorni; audit log almeno 2 anni; account eliminati anonimizzati subito (obiettivo: entro 30 giorni).
