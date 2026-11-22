# Ponte per il tempo reale

Il sito GTT non permette ad altre pagine web di leggere i passaggi in tempo reale delle paline. `worker.js` è un piccolo programma da mettere su Cloudflare Workers (gratuito, fino a 100.000 richieste al giorno) che li legge e li passa all'app.

## Come attivarlo

1. Crea un account gratuito su https://dash.cloudflare.com/sign-up.
2. Nel menu a sinistra apri **Workers & Pages** (o **Compute → Workers**) e tocca **Create**, poi **Start with Hello World**.
3. Come nome scrivi `come-ci-arrivo` e tocca **Deploy**.
4. Tocca **Edit code**, cancella tutto, incolla il contenuto di `worker.js` e tocca **Deploy**.
5. Copia l'indirizzo del worker, del tipo `https://come-ci-arrivo.<tuo-nome>.workers.dev`.
6. In `src/app.js` metti quell'indirizzo in `const RT_PROXY = '';`, poi esegui `python3 tools/build_page.py`.

Prova: aprendo `https://come-ci-arrivo.<tuo-nome>.workers.dev/palina/252` devi vedere un elenco in formato JSON con le linee e gli orari.

Il servizio GTT usato non è documentato: se GTT lo cambia, il tempo reale smette di funzionare e l'app continua con gli orari programmati.
