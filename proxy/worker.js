/**
 * "Ponte" per i passaggi in tempo reale di GTT (Cloudflare Worker gratuito).
 *
 * Il sito GTT non permette ad altri siti di leggere i passaggi in tempo reale delle paline.
 * Questo worker li legge e li restituisce all'app con il permesso giusto (intestazione CORS).
 * Risponde solo a  /palina/<numero>  e solo al sito dell'app.
 */
const ALLOWED_ORIGINS = ['https://mikeflower.github.io'];

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const origin = request.headers.get('Origin') || '';
    const cors = {
      'Access-Control-Allow-Origin': ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0],
      'Access-Control-Allow-Methods': 'GET',
      Vary: 'Origin',
    };
    if (request.method === 'OPTIONS') return new Response(null, { headers: cors });

    const m = url.pathname.match(/^\/palina\/(\d{1,6})$/);
    if (request.method !== 'GET' || !m) return new Response('Non trovato', { status: 404, headers: cors });

    // 20 secondi di cache: tante persone alla stessa palina = una sola richiesta a GTT
    const cache = caches.default;
    const key = new Request(`https://come-ci-arrivo.cache/palina/${m[1]}`);
    let res = await cache.match(key);
    if (!res) {
      const gtt = 'https://www.gtt.to.it/cms/index.php?option=com_gtt&task=palina.getTransitiOld'
        + `&palina=${m[1]}&realtime=true&get_param=value`;
      const r = await fetch(gtt, { headers: { 'User-Agent': 'come-ci-arrivo (app non ufficiale)' } });
      const body = await r.text();
      if (!r.ok || !body.trim().startsWith('[')) {
        return new Response('[]', { status: 502, headers: { ...cors, 'Content-Type': 'application/json' } });
      }
      res = new Response(body, { headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'max-age=20' } });
      ctx.waitUntil(cache.put(key, res.clone()));
    }
    const out = new Response(res.body, res);
    for (const [k, v] of Object.entries(cors)) out.headers.set(k, v);
    return out;
  },
};
