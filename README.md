# Come ci arrivo

Web app per Torino: scegli partenza e arrivo e ti dice quale bus, tram o metro GTT prendere, dove salire e scendere e a che ora arrivi.

**Sito:** https://mikeflower.github.io/come-ci-arrivo/

- Partenza dal GPS del telefono, dal numero di palina, dal nome della fermata, da un indirizzo o con un tocco sulla mappa.
- Orari programmati dal GTFS ufficiale di GTT (non in tempo reale). Per ogni fermata c'e' il link ai passaggi in tempo reale sul sito GTT.
- Il calcolo del percorso (algoritmo RAPTOR) gira tutto nel telefono: nessun server.

## Struttura

| Percorso | Cosa contiene |
| --- | --- |
| `docs/` | il sito pubblicato da GitHub Pages (`index.html`, `rete.json`, icone) |
| `src/router.js` | calcolo dei percorsi |
| `src/app.js`, `src/style.css`, `src/page.html` | interfaccia e mappa |
| `tools/build_data.py` | converte il GTFS di GTT in `docs/rete.json` |
| `tools/build_page.py` | assembla `src/` in `docs/index.html` |
| `.github/workflows/aggiorna-orari.yml` | ogni lunedi riscarica gli orari GTT e aggiorna il sito |

## Aggiornare gli orari a mano

```bash
curl -L -o gtfs.zip https://www.gtt.to.it/open_data/gtt_gtfs.zip && mkdir -p gtfs && unzip -o gtfs.zip -d gtfs
python3 tools/build_data.py gtfs docs/rete.json
python3 tools/build_page.py
```

Oppure dalla scheda **Actions** del repository: "Aggiorna orari GTT" → "Run workflow".

## Dati e licenza

Dati: GTT S.p.A. – Gruppo Torinese Trasporti (https://www.gtt.to.it). La licenza GTT richiede di citare la fonte e vieta l'uso commerciale senza autorizzazione scritta. Ricerca indirizzi: OpenStreetMap Nominatim. App non ufficiale.
