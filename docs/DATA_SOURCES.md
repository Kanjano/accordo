# Fonti dati

## Geografia (`packages/db/data/`)

Generati da `pnpm geo:import` (`scripts/import-geo.ts`) e versionati, così il seed funziona anche offline.

| Dato                                                                                                     | Fonte                                                                                                                                                                                            | Licenza                                  |
| -------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------- |
| Regioni, province (unità territoriali sovracomunali), comuni, codici ISTAT, codici catastali, capoluoghi | ISTAT, [Elenco dei codici e delle denominazioni delle unità territoriali](https://www.istat.it/classificazione/codici-dei-comuni-delle-province-e-delle-regioni/) (`Elenco-comuni-italiani.csv`) | CC BY 4.0 — attribuzione: «Fonte: ISTAT» |
| Coordinate del comune (P625) e CAP (P281)                                                                | [Wikidata](https://www.wikidata.org), query SPARQL per codice ISTAT (P635)                                                                                                                       | CC0                                      |

- `comuni.json`: tutti i comuni (7.896 all'ultima importazione, 30/10/2026). 197 comuni non hanno coordinate su Wikidata: `lat`/`lng` restano `null` e sono esclusi dalla ricerca per distanza. 203 non hanno CAP.
- `capoluoghi.json`: solo i capoluoghi di provincia, usato dal seed se `comuni.json` manca.
- I nomi bilingui ISTAT (es. «Bolzano/Bozen») sono ridotti alla parte italiana per regioni e province; i comuni mantengono la denominazione italiana ufficiale.
- Gli intervalli di CAP di Wikidata (es. `00118–00199`) vengono espansi se coprono al massimo 300 valori.
- Scartato `matteocontrini/comuni-json`: nessuna licenza dichiarata.

**Da fare prima del lancio:** inserire l'attribuzione ISTAT nelle note legali.

## Catalogo e dati demo

- Reparti, categorie, attributi, marche: SPEC §19 (le marche sono solo dati descrittivi, nessun logo).
- Dati demo: generati con Faker (`it`) e seed fisso; immagini segnaposto create localmente con sharp (sfumatura + nome categoria). Nessun contenuto preso dal web.
