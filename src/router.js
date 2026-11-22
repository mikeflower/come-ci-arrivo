/* Calcolo dei percorsi sui dati GTT (algoritmo RAPTOR).
 * Funziona sia nel browser (window.GTTRouter) sia in Node (module.exports). */
(function (root) {
  'use strict';

  const WALK_SPEED = 1.3;       // m/s a piedi
  const DETOUR = 1.3;           // le strade non sono in linea d'aria
  const TRANSFER_RADIUS = 400;  // m, cambio a piedi tra fermate vicine
  const ACCESS_RADIUS = 1000;   // m, fermate raggiungibili a piedi da partenza/arrivo
  const MAX_ACCESS_RADIUS = 2500;
  const MAX_WALK_ONLY = 35 * 60; // s, oltre non proponiamo di andare solo a piedi
  const SLACK = 60;             // s di margine per ogni cambio
  const MAX_ROUNDS = 5;         // fino a 4 cambi
  const INF = 1e9;
  const DAY = 86400;

  function walkSecs(m) { return Math.round(m * DETOUR / WALK_SPEED); }

  function dist(lat1, lon1, lat2, lon2) {
    const x = (lon2 - lon1) * Math.cos((lat1 + lat2) * Math.PI / 360) * 111320;
    const y = (lat2 - lat1) * 110574;
    return Math.sqrt(x * x + y * y);
  }

  function parseYmd(s) {
    return Date.UTC(+s.slice(0, 4), +s.slice(4, 6) - 1, +s.slice(6, 8));
  }

  class Network {
    constructor(data) {
      this.feed = data.feed;
      const S = data.stops;
      const n = this.nStops = S.code.length;
      this.code = S.code; this.name = S.name; this.desc = S.desc; this.city = S.city;
      this.lat = new Float64Array(n); this.lon = new Float64Array(n);
      for (let i = 0; i < n; i++) { this.lat[i] = S.lat[i] / 1e5; this.lon[i] = S.lon[i] / 1e5; }
      this.routes = data.routes.map(([short, long, type, agency]) => ({ short, long, type, agency }));
      this.services = data.services;
      this.patterns = data.patterns.map((p) => {
        const stops = Int32Array.from(p.s);
        const profs = p.p.map((d) => {
          const c = new Int32Array(d.length + 1);
          for (let i = 0; i < d.length; i++) c[i + 1] = c[i] + d[i];
          return c;
        });
        const m = p.t.length / 3;
        const svc = new Int32Array(m), start = new Int32Array(m), prof = new Int32Array(m);
        for (let k = 0; k < m; k++) { svc[k] = p.t[3 * k]; start[k] = p.t[3 * k + 1]; prof[k] = p.t[3 * k + 2]; }
        return { route: p.r, head: p.h, stops, profs, svc, start, prof, n: m };
      });

      // fermata -> elenco di (pattern, posizione)
      const cnt = new Int32Array(n + 1);
      this.patterns.forEach((P) => P.stops.forEach((s) => cnt[s + 1]++));
      for (let i = 0; i < n; i++) cnt[i + 1] += cnt[i];
      this.spOff = cnt;
      const fill = cnt.slice(0, n);
      this.spPat = new Int32Array(cnt[n]); this.spPos = new Int32Array(cnt[n]);
      this.patterns.forEach((P, pi) => P.stops.forEach((s, pos) => {
        const j = fill[s]++; this.spPat[j] = pi; this.spPos[j] = pos;
      }));

      // griglia per trovare le fermate vicine
      this.cell = 0.005;
      this.grid = new Map();
      for (let i = 0; i < n; i++) {
        const key = this._key(Math.floor(this.lat[i] / this.cell), Math.floor(this.lon[i] / this.cell));
        let a = this.grid.get(key); if (!a) this.grid.set(key, (a = []));
        a.push(i);
      }

      // cambi a piedi tra fermate vicine
      this.transfers = new Array(n);
      for (let i = 0; i < n; i++) {
        this.transfers[i] = this.nearStops(this.lat[i], this.lon[i], TRANSFER_RADIUS)
          .filter((x) => x.s !== i).map((x) => [x.s, walkSecs(x.d)]);
      }
      this._tt = new Map();
      this.feedStart = parseYmd(this.feed.start);
    }

    _key(a, b) { return a * 100000 + b; }

    nearStops(lat, lon, radius) {
      const out = [];
      const cl = Math.ceil(radius / 550) + 1;
      const a0 = Math.floor(lat / this.cell), b0 = Math.floor(lon / this.cell);
      for (let a = a0 - cl; a <= a0 + cl; a++) {
        for (let b = b0 - cl; b <= b0 + cl; b++) {
          const g = this.grid.get(this._key(a, b)); if (!g) continue;
          for (const s of g) {
            const d = dist(lat, lon, this.lat[s], this.lon[s]);
            if (d <= radius) out.push({ s, d });
          }
        }
      }
      out.sort((x, y) => x.d - y.d);
      return out;
    }

    nearestStop(lat, lon) {
      for (const r of [300, 1000, 3000, 10000]) {
        const a = this.nearStops(lat, lon, r);
        if (a.length) return a[0];
      }
      return null;
    }

    /** Indice del giorno rispetto all'inizio del feed (date come anno, mese 1-12, giorno). */
    dayIndex(y, m, d) { return Math.round((Date.UTC(y, m - 1, d) - this.feedStart) / DAY / 1000); }

    inFeed(day) { return day >= 0 && day < this.feed.days; }

    /** Corse attive in un giorno di servizio: quelle del giorno, quelle della sera prima
     *  che proseguono dopo mezzanotte, e le prime del mattino dopo. */
    timetable(day) {
      if (this._tt.has(day)) return this._tt.get(day);
      const sv = this.services;
      const on = (svc, d) => d >= 0 && d < this.feed.days && sv[svc].charCodeAt(d) === 49;
      const tt = this.patterns.map((P) => {
        const st = [], pr = [], id = [];
        for (let k = 0; k < P.n; k++) {
          const last = P.profs[P.prof[k]][P.stops.length - 1];
          if (on(P.svc[k], day - 1) && P.start[k] + last >= DAY) { st.push(P.start[k] - DAY); pr.push(P.prof[k]); id.push(k); }
          if (on(P.svc[k], day)) { st.push(P.start[k]); pr.push(P.prof[k]); id.push(k); }
          if (on(P.svc[k], day + 1) && P.start[k] < 10 * 3600) { st.push(P.start[k] + DAY); pr.push(P.prof[k]); id.push(k); }
        }
        const ord = st.map((_, i) => i).sort((a, b) => st[a] - st[b]);
        return {
          n: ord.length,
          start: Int32Array.from(ord, (i) => st[i]),
          prof: Int32Array.from(ord, (i) => pr[i]),
          id: Int32Array.from(ord, (i) => id[i]),
        };
      });
      if (this._tt.size > 3) this._tt.clear();
      this._tt.set(day, tt);
      return tt;
    }

    _access(lat, lon, stops) {
      if (stops && stops.length) {
        const extra = this.nearStops(lat, lon, 500);
        const seen = new Set();
        const out = [];
        for (const s of stops) { seen.add(s); out.push({ s, d: dist(lat, lon, this.lat[s], this.lon[s]) }); }
        for (const x of extra) if (!seen.has(x.s)) out.push(x);
        return out.map((x) => ({ s: x.s, d: x.d, w: walkSecs(x.d) }));
      }
      let a = this.nearStops(lat, lon, ACCESS_RADIUS);
      if (a.length < 4) a = this.nearStops(lat, lon, MAX_ACCESS_RADIUS).slice(0, 12);
      return a.map((x) => ({ s: x.s, d: x.d, w: walkSecs(x.d) }));
    }

    /** Una ricerca RAPTOR: restituisce i percorsi ottimi per numero di cambi. */
    _search(day, t0, access, egress, from, to) {
      const n = this.nStops;
      const tt = this.timetable(day);
      const arr = [new Float64Array(n).fill(INF)];
      const par = [new Array(n)];
      const best = new Float64Array(n).fill(INF);
      let marked = new Set();
      for (const a of access) {
        const t = t0 + a.w;
        if (t < arr[0][a.s]) { arr[0][a.s] = t; best[a.s] = t; par[0][a.s] = { t: 'a', w: a.w, d: a.d }; marked.add(a.s); }
      }
      const egW = new Map();
      for (const e of egress) if (!egW.has(e.s) || egW.get(e.s).w > e.w) egW.set(e.s, e);
      let bestTarget = INF;
      const found = [];

      for (let k = 1; k <= MAX_ROUNDS && marked.size; k++) {
        arr[k] = Float64Array.from(arr[k - 1]);
        par[k] = new Array(n);
        const Q = new Map();
        for (const s of marked) {
          for (let j = this.spOff[s]; j < this.spOff[s + 1]; j++) {
            const p = this.spPat[j], pos = this.spPos[j];
            const q = Q.get(p);
            if (q === undefined || pos < q) Q.set(p, pos);
          }
        }
        const improved = new Set();
        const prev = arr[k - 1];
        const cur = arr[k];
        for (const [pi, pos0] of Q) {
          const P = this.patterns[pi], T = tt[pi];
          if (!T.n) continue;
          const L = P.stops.length;
          let trip = -1, bPos = -1;
          for (let pos = pos0; pos < L; pos++) {
            const s = P.stops[pos];
            if (trip >= 0) {
              const a = T.start[trip] + P.profs[T.prof[trip]][pos];
              if (a < best[s] && a < bestTarget) {
                cur[s] = a; best[s] = a;
                par[k][s] = { t: 'r', p: pi, trip, b: bPos, a: pos };
                improved.add(s);
              }
            }
            if (prev[s] < INF && pos < L - 1) {
              const ready = prev[s] + (k > 1 ? SLACK : 0);
              if (trip < 0 || ready < T.start[trip] + P.profs[T.prof[trip]][pos]) {
                let lo = 0, hi = trip < 0 ? T.n : trip;
                while (lo < hi) {
                  const mid = (lo + hi) >> 1;
                  if (T.start[mid] + P.profs[T.prof[mid]][pos] >= ready) hi = mid; else lo = mid + 1;
                }
                if (lo < (trip < 0 ? T.n : trip)) { trip = lo; bPos = pos; }
              }
            }
          }
        }
        // cambi a piedi
        marked = new Set(improved);
        const queue = Array.from(improved);
        while (queue.length) {
          const s = queue.pop();
          for (const [s2, w] of this.transfers[s]) {
            const a = cur[s] + w;
            if (a < best[s2] && a < bestTarget) {
              cur[s2] = a; best[s2] = a;
              par[k][s2] = { t: 'w', from: s, w };
              if (!marked.has(s2)) marked.add(s2);
            }
          }
        }
        // destinazione
        let bestE = -1;
        for (const s of marked) {
          const e = egW.get(s);
          if (e && cur[s] + e.w < bestTarget) { bestTarget = cur[s] + e.w; bestE = s; }
        }
        if (bestE >= 0) found.push(this._rebuild(k, bestE, egW.get(bestE), arr, par, tt, from, to, bestTarget));
      }
      return found;
    }

    _rebuild(k, e, eg, arr, par, tt, from, to, arrival) {
      const legs = [];
      const stopPt = (s) => ({ stop: s, lat: this.lat[s], lon: this.lon[s] });
      legs.push({ type: 'walk', from: stopPt(e), to, dur: eg.w, dist: eg.d, start: arrival - eg.w, end: arrival });
      let s = e, kk = k;
      while (kk > 0) {
        let p = par[kk][s];
        while (!p && kk > 0) { kk--; p = par[kk][s]; }
        if (kk === 0) break;
        while (p && p.t === 'w') {
          legs.unshift({ type: 'walk', from: stopPt(p.from), to: stopPt(s), dur: p.w,
            dist: dist(this.lat[p.from], this.lon[p.from], this.lat[s], this.lon[s]),
            start: arr[kk][s] - p.w, end: arr[kk][s] });
          s = p.from; p = par[kk][s];
        }
        if (!p || p.t !== 'r') break;
        const P = this.patterns[p.p], T = tt[p.p];
        const c = P.profs[T.prof[p.trip]];
        const base = T.start[p.trip];
        const times = [];
        const stops = [];
        for (let i = p.b; i <= p.a; i++) { stops.push(P.stops[i]); times.push(base + c[i]); }
        legs.unshift({
          type: 'ride', pattern: p.p, route: P.route, head: P.head,
          trip: T.id[p.trip], boardPos: p.b, alightPos: p.a,
          from: stopPt(P.stops[p.b]), to: stopPt(P.stops[p.a]),
          start: base + c[p.b], end: base + c[p.a], stops, times,
        });
        s = P.stops[p.b];
        kk--;
      }
      const p0 = par[0][s];
      const firstRide = legs.find((l) => l.type === 'ride');
      if (p0 && firstRide) {
        legs.unshift({ type: 'walk', from, to: stopPt(s), dur: p0.w, dist: p0.d,
          start: firstRide.start - p0.w, end: firstRide.start });
      }
      // le camminate intermedie partono appena scesi
      return finish(legs, from, to);
    }

    /** Cerca i percorsi.
     * q = { from:{lat,lon,stops?}, to:{lat,lon,stops?}, day, time (secondi dalla mezzanotte) } */
    plan(q) {
      const from = { lat: q.from.lat, lon: q.from.lon };
      const to = { lat: q.to.lat, lon: q.to.lon };
      const out = [];
      const direct = dist(from.lat, from.lon, to.lat, to.lon);
      const walkOnly = walkSecs(direct);
      if (walkOnly <= MAX_WALK_ONLY) {
        out.push(finish([{ type: 'walk', from, to, dur: walkOnly, dist: direct, start: q.time, end: q.time + walkOnly }], from, to));
      }
      if (!this.inFeed(q.day) && !this.inFeed(q.day - 1)) return { journeys: out, reason: 'outside' };
      const access = this._access(from.lat, from.lon, q.from.stops);
      const egress = this._access(to.lat, to.lon, q.to.stops);
      if (!access.length || !egress.length) return { journeys: out, reason: access.length ? 'noEgress' : 'noAccess' };

      let t = q.time;
      for (let i = 0; i < 4; i++) {
        const res = this._search(q.day, t, access, egress, from, to).filter((j) => j.rides > 0);
        if (!res.length) break;
        out.push(...(i === 0 ? res : [res[res.length - 1]]));
        const fastest = res[res.length - 1];
        t = Math.max(t + 60, fastest.leave + 60);
      }
      return { journeys: prune(out), reason: null };
    }
  }

  function finish(legs, from, to) {
    const rides = legs.filter((l) => l.type === 'ride');
    return {
      legs, rides: rides.length, transfers: Math.max(0, rides.length - 1),
      leave: legs[0].start, arrive: legs[legs.length - 1].end,
      walk: legs.filter((l) => l.type === 'walk').reduce((a, l) => a + l.dur, 0),
      key: rides.map((r) => `${r.pattern}:${r.trip}:${r.boardPos}:${r.alightPos}`).join('|') || 'walk',
    };
  }

  function prune(list) {
    const uniq = new Map();
    for (const j of list) if (!uniq.has(j.key)) uniq.set(j.key, j);
    const a = Array.from(uniq.values());
    const keep = a.filter((j) => !a.some((o) => o !== j && (
      // o e' meglio sotto ogni aspetto
      (o.leave >= j.leave && o.arrive <= j.arrive && o.transfers <= j.transfers &&
        o.walk <= j.walk + 120 &&
        (o.leave > j.leave || o.arrive < j.arrive || o.transfers < j.transfers || o.walk < j.walk)) ||
      // o parte quasi alla stessa ora, arriva molto prima e con meno cambi
      (o.leave >= j.leave - 300 && o.arrive + 600 <= j.arrive && o.transfers <= j.transfers))));
    // ordine: arrivo, con 3 minuti di "costo" per ogni cambio e un peso per le camminate lunghe
    const cost = (j) => j.arrive + 180 * j.transfers + (j.rides ? 0.5 : 1) * Math.max(0, j.walk - 600);
    keep.sort((x, y) => cost(x) - cost(y) || y.leave - x.leave);
    return keep.slice(0, 6);
  }

  const api = { Network, dist, walkSecs };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.GTTRouter = api;
})(typeof window !== 'undefined' ? window : globalThis);
