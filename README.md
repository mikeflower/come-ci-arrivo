# Come ci arrivo

Web app per Torino: scegli partenza e arrivo e ti dice quale bus, tram o metro GTT prendere, dove salire e scendere e a che ora arrivi.

**Sito:** https://mikeflower.github.io/come-ci-arrivo/

- **Partenza e arrivo:** GPS del telefono, numero di palina (anche inquadrando il QR sul cartello), nome della fermata, indirizzo o un tocco sulla mappa.
- **Casa e Lavoro:** due pulsanti per partire con un tocco dalla posizione attuale.
- **Quando:** adesso, "Parti alle…" oppure "Arriva entro…".
- **Solo mezzi accessibili:** esclude le corse che GTT indica come non accessibili in carrozzina.
- **Tabellone:** le prossime partenze di una fermata, dalla mappa o dai passi del percorso.
- **Condividi:** manda il percorso per messaggio.
- **Avvisami quando scendere:** durante il viaggio segue il GPS e vibra e suona prima della fermata giusta (con la pagina aperta).
- **Mappa con le strade** di OpenStreetMap.
- **Funziona senza rete:** pagina e orari restano nel telefono.
- **Tempo reale:** se attivi il ponte descritto in [`proxy/README.md`](proxy/README.md).
- Orari programmati dal GTFS ufficiale di GTT, aggiornati ogni lunedì. Il calcolo del percorso (algoritmo RAPTOR) gira tutto nel telefono.

## Struttura

| Percorso | Cosa contiene |
| --- | --- |
| `docs/` | il sito pubblicato da GitHub Pages (`index.html`, `rete.json`, icone) |
| `src/router.js` | calcolo dei percorsi |
| `src/app.js`, `src/style.css`, `src/page.html` | interfaccia e mappa |
| `tools/build_data.py` | converte il GTFS di GTT in `docs/rete.json` |
| `tools/build_page.py` | assembla `src/` in `docs/index.html` e genera `docs/sw.js` |
| `src/sw.js` | modello del service worker per l'uso senza rete |
| `proxy/` | ponte Cloudflare per il tempo reale |
| `docs/jsQR.js` | lettura dei QR (jsQR, Apache-2.0) |
| `.github/workflows/aggiorna-orari.yml` | ogni lunedi riscarica gli orari GTT e aggiorna il sito |

## Aggiornare gli orari a mano

```bash
curl -L -o gtfs.zip https://www.gtt.to.it/open_data/gtt_gtfs.zip && mkdir -p gtfs && unzip -o gtfs.zip -d gtfs
python3 tools/build_data.py gtfs docs/rete.json
python3 tools/build_page.py
```

Oppure dalla scheda **Actions** del repository: "Aggiorna orari GTT" → "Run workflow".

## Dati e licenza

Dati: GTT S.p.A. – Gruppo Torinese Trasporti (https://www.gtt.to.it). La licenza GTT richiede di citare la fonte e vieta l'uso commerciale senza autorizzazione scritta. Ricerca indirizzi: OpenStreetMap Nominatim. Mappa: © OpenStreetMap contributors. App non ufficiale.
