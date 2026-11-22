(function () {
  'use strict';
  const R = window.GTTRouter;
  const $ = (id) => document.getElementById(id);

  function h(tag, attrs, ...kids) {
    const e = document.createElement(tag);
    if (attrs) {
      for (const [k, v] of Object.entries(attrs)) {
        if (v == null || v === false) continue;
        if (k === 'class') e.className = v;
        else if (k === 'text') e.textContent = v;
        else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
        else e.setAttribute(k, v === true ? '' : String(v));
      }
    }
    for (const c of kids.flat()) {
      if (c == null || c === false) continue;
      e.append(c.nodeType ? c : document.createTextNode(String(c)));
    }
    return e;
  }
  function icon(svg) { const s = document.createElement('span'); s.innerHTML = svg; return s.firstChild; }
  const WALK_SVG = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="13.5" cy="4" r="2"/><path d="M11.3 7.2 7.6 9v4h1.9v-2.8l1.3-.6-1.6 10.4h2l1-5.3 2 2V22h2v-6.3l-2.1-2.1.6-3.3A5.5 5.5 0 0 0 18.6 13v-2a3.6 3.6 0 0 1-3.1-1.9l-1-1.6a2.1 2.1 0 0 0-3.2-.3z"/></svg>';

  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* niente */ } },
  };

  // ---------- tempo ----------
  function romeNow() {
    const f = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Rome', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
    const p = {};
    for (const x of f.formatToParts(new Date())) p[x.type] = x.value;
    return { y: +p.year, m: +p.month, d: +p.day, secs: (+p.hour % 24) * 3600 + (+p.minute) * 60 + (+p.second) };
  }
  const pad = (n) => String(n).padStart(2, '0');
  function hm(t) {
    const mins = Math.floor(t / 60);
    const hh = ((Math.floor(mins / 60) % 24) + 24) % 24;
    return `${pad(hh)}:${pad(((mins % 60) + 60) % 60)}`;
  }
  function dur(sec) {
    const m = Math.max(1, Math.round(sec / 60));
    return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h${m % 60 ? ' ' + (m % 60) + ' min' : ''}`;
  }
  function meters(m) { return m < 950 ? `${Math.round(m / 10) * 10} m` : `${(m / 1000).toFixed(1).replace('.', ',')} km`; }
  const MONTHS = ['gen', 'feb', 'mar', 'apr', 'mag', 'giu', 'lug', 'ago', 'set', 'ott', 'nov', 'dic'];
  function ymdLabel(s) { return `${+s.slice(6, 8)} ${MONTHS[+s.slice(4, 6) - 1]} ${s.slice(0, 4)}`; }
  function ymdIso(s) { return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`; }

  // ---------- linee ----------
  function mode(r) {
    if (r.agency === 'T') return 'tour';
    if (r.type === 1) return 'metro';
    if (r.type === 0) return 'tram';
    if (r.agency === 'E') return 'extra';
    return 'bus';
  }
  function noun(r) {
    const m = mode(r);
    if (m === 'metro') return 'la metro';
    if (m === 'tram') return 'il tram';
    if (r.type === 7) return 'la cremagliera';
    if (m === 'tour' && r.type === 0) return 'il tram storico';
    return 'il bus';
  }
  function badge(r) { return h('span', { class: `badge m-${mode(r)}`, text: r.short.replace(/\/$/, '/') }); }
  const liveUrl = (code) => `https://www.gtt.to.it/cms/percorari/arrivi?option=com_gtt&view=palina&palina=${encodeURIComponent(code)}`;

  // ---------- ricerca luoghi ----------
  function norm(s) {
    return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
      .replace(/\bc\.\s*so\b|\bcso\b/g, 'corso ')
      .replace(/\bp\.\s*z?za\b|\bpzz?a\b/g, 'piazza ')
      .replace(/\bp\.\s*le\b/g, 'piazzale ')
      .replace(/\bv\.\s*le\b/g, 'viale ')
      .replace(/\bl\.\s*go\b/g, 'largo ')
      .replace(/\bstr\.\s*/g, 'strada ')
      .replace(/\bstaz\.\s*/g, 'stazione ')
      .replace(/\bc\.\s*(?=[a-z])/g, 'corso ')
      .replace(/\bv\.\s*(?=[a-z])/g, 'via ')
      .replace(/[^a-z0-9]+/g, ' ').trim();
  }

  let net = null;
  let places = [];
  const byCode = new Map();

  function buildPlaces() {
    const groups = new Map();
    for (let s = 0; s < net.nStops; s++) {
      byCode.set(String(net.code[s]), s);
      const key = norm(net.name[s]) + '|' + net.city[s];
      let arr = groups.get(key);
      if (!arr) groups.set(key, (arr = []));
      let c = arr.find((c) => R.dist(c.lat, c.lon, net.lat[s], net.lon[s]) < 450);
      if (!c) arr.push((c = { stops: [], lat: net.lat[s], lon: net.lon[s] }));
      c.stops.push(s);
    }
    places = [];
    for (const arr of groups.values()) {
      for (const c of arr) {
        const s0 = c.stops[0];
        let lat = 0, lon = 0;
        for (const s of c.stops) { lat += net.lat[s]; lon += net.lon[s]; }
        lat /= c.stops.length; lon /= c.stops.length;
        const descs = [...new Set(c.stops.map((s) => net.desc[s]).filter(Boolean))];
        const label = net.name[s0];
        const city = net.city[s0];
        const nameN = norm(label);
        const extra = descs.find((d) => norm(d) !== nameN);
        const codes = c.stops.map((s) => net.code[s]);
        const sub = [codes.length > 1 ? `Paline ${codes.slice(0, 3).join(', ')}${codes.length > 3 ? '…' : ''}` : `Palina ${codes[0]}`,
          extra, city !== 'Torino' ? city : null].filter(Boolean).join(' · ');
        const nums = [];
        for (const d of descs) for (const m of d.matchAll(/\b(\d{1,4})\b/g)) nums.push(+m[1]);
        places.push({
          kind: 'stop', label, sub, city, lat, lon, stops: c.stops, nums,
          nameTok: nameN.split(' '), tok: norm([label, ...descs, city].join(' ')).split(' '),
        });
      }
    }
  }

  function stopPlace(s) {
    return {
      kind: 'stop', label: net.name[s], palina: String(net.code[s]),
      sub: [net.desc[s] && norm(net.desc[s]) !== norm(net.name[s]) ? net.desc[s] : null, net.city[s]].filter(Boolean).join(' · '),
      lat: net.lat[s], lon: net.lon[s], stops: [s],
    };
  }
  /** Testo di un luogo: le paline singole mostrano anche il numero. */
  const placeText = (p) => (p.palina ? `${p.label} · palina ${p.palina}` : p.label);

  // "1088", "palina 1088", "fermata 1088", "n. 1088", "#1088"
  const PAL_RE = /^(?:palina|paline|pal|fermata|ferm|numero|num|nr|n)?\s*(\d{1,6})$/;
  function searchPaline(digits) {
    if (!digits) return [];
    const hits = [];
    for (let s = 0; s < net.nStops; s++) {
      const c = String(net.code[s]);
      if (c.startsWith(digits)) hits.push([c, s]);
    }
    hits.sort((a, b) => a[0].length - b[0].length || +a[0] - +b[0]);
    return hits.slice(0, 8).map(([, s]) => stopPlace(s));
  }

  const GENERIC = new Set(['via', 'corso', 'piazza', 'piazzale', 'largo', 'strada', 'viale', 'lungo', 'borgata', 'fermata', 'di', 'del', 'della']);
  function searchPlaces(q) {
    const nq = norm(q);
    if (!nq) return [];
    const pal = nq.match(PAL_RE);
    if (pal) return searchPaline(pal[1]);
    const out = [];
    const qt = nq.split(' ');
    const words = qt.filter((t) => !/^\d+$/.test(t));
    const civic = qt.filter((t) => /^\d+$/.test(t)).map(Number);
    for (const p of places) {
      let score = 0, ok = words.length > 0, first = true;
      for (let i = 0; i < words.length; i++) {
        const t = words[i];
        if (GENERIC.has(t)) {
          // "piazza", "corso"... contano poco: il nome vero e' la parola dopo
          if (p.tok.some((w) => w.startsWith(t))) score += 1;
          continue;
        }
        const isFirst = first; first = false;
        if (p.nameTok.some((w) => w.startsWith(t))) score += 3 + (isFirst && p.nameTok[0].startsWith(t) ? 3 : 0);
        else if (p.tok.some((w) => w.startsWith(t))) score += 1;
        else { ok = false; break; }
      }
      if (!ok) continue;
      const strong = words.filter((t) => !GENERIC.has(t));
      if (strong.length && strong.length === p.nameTok.length && strong.every((t, i) => p.nameTok[i] === t)) score += 2;
      // numero civico: le descrizioni GTT spesso lo riportano ("Corso Francia n. 214")
      for (const n of civic) {
        if (p.nameTok.includes(String(n))) score += 3;
        else if (p.nums.length) score += 3 * Math.max(0, 1 - Math.min(...p.nums.map((x) => Math.abs(x - n))) / 120);
      }
      if (p.city === 'Torino') score += 1;
      score += Math.min(p.stops.length, 4) * 0.3;
      out.push({ score, place: p });
    }
    out.sort((a, b) => b.score - a.score || a.place.label.length - b.place.label.length);
    return out.slice(0, 8).map((x) => x.place);
  }

  // indirizzi: OpenStreetMap Nominatim, solo dove la pagina puo' raggiungerlo
  // dentro un riquadro (la pagina su claude.ai) le richieste esterne sono bloccate
  let addrBlocked = window.self !== window.top;
  async function searchAddress(q, signal) {
    if (addrBlocked || q.length < 4) return [];
    const url = 'https://nominatim.openstreetmap.org/search?' + new URLSearchParams({
      format: 'jsonv2', q, limit: '5', countrycodes: 'it', 'accept-language': 'it',
      viewbox: '7.25,45.45,8.05,44.85', bounded: '1', addressdetails: '1',
    });
    try {
      const r = await fetch(url, { signal });
      if (!r.ok) return [];
      const js = await r.json();
      return js.map((x) => {
        const a = x.address || {};
        const road = [a.road || a.pedestrian || a.square || x.name, a.house_number].filter(Boolean).join(' ');
        const label = x.name && x.name !== a.road ? x.name : road || x.display_name.split(',')[0];
        const sub = [x.name && x.name !== a.road ? road : null, a.suburb || a.quarter, a.city || a.town || a.village].filter(Boolean).join(' · ');
        return { kind: 'addr', label, sub, lat: +x.lat, lon: +x.lon };
      });
    } catch (e) {
      if (e.name !== 'AbortError') addrBlocked = true;
      return [];
    }
  }

  // ---------- stato ----------
  const state = { from: null, to: null, when: 'now', result: null, q: null, sel: 0, pick: null, example: false };
  const recents = () => store.get('cca.recenti', []);
  function remember(p) {
    if (!p || p.kind === 'gps' || p.kind === 'map') return;
    const slim = { kind: p.kind, label: p.label, sub: p.sub, lat: p.lat, lon: p.lon, stops: p.stops, palina: p.palina };
    const list = recents().filter((x) => !(x.label === slim.label && Math.abs(x.lat - slim.lat) < 1e-4));
    list.unshift(slim);
    store.set('cca.recenti', list.slice(0, 6));
  }

  function setMsg(text) { $('msg').textContent = text || ''; }
  function hideExample() { if (state.example) { state.example = false; $('example').hidden = true; } }

  function setPlace(role, place, opts = {}) {
    state[role] = place;
    $(`${role}-input`).value = place ? placeText(place) : '';
    if (!opts.keepExample) hideExample();
    map.setEndpoints(state.from, state.to);
    if (state.from && state.to) plan();
    else if (place) { map.focus(place.lat, place.lon); renderIdle(); }
  }

  // ---------- campi con suggerimenti ----------
  function makeField(role) {
    const input = $(`${role}-input`), list = $(`${role}-suggest`), palBtn = $(`${role}-palina`);
    const basePlaceholder = input.placeholder;
    let items = [], active = -1, ctl = null, addr = [], addrNote = null, lastQ = '', palMode = false;

    function setPalMode(on) {
      palMode = on;
      palBtn.setAttribute('aria-pressed', String(on));
      input.inputMode = on ? 'numeric' : 'search';
      input.placeholder = on ? 'Numero di palina, es. 1088' : basePlaceholder;
    }

    function render(local, o = {}) {
      list.replaceChildren();
      items = [];
      if (o.hint) list.append(h('li', { class: 's-hint', role: 'presentation', text: o.hint }));
      const add = (head, arr, recent) => {
        if (!arr.length) return;
        if (head) list.append(h('li', { class: 's-head', role: 'presentation', text: head }));
        for (const p of arr) {
          const i = items.length;
          items.push(p);
          const kind = p.palina ? `Palina ${p.palina}` : recent ? 'Recente' : p.kind === 'addr' || p.kind === 'addr-search' ? 'Indirizzo' : 'Fermata';
          list.append(h('li', { role: 'option', id: `${role}-opt-${i}`, 'aria-selected': 'false', 'data-i': i },
            h('span', { class: 's-name', text: p.label }),
            h('span', { class: p.palina ? 's-kind pal' : 's-kind', text: kind }),
            p.sub ? h('span', { class: 's-sub', text: p.sub }) : null));
        }
      };
      add(o.heading, local, o.heading === 'Recenti');
      add(addr.length ? 'Indirizzi' : null, addr);
      if (o.action) add(null, [o.action]);
      if (o.foot) list.append(h('li', { class: 's-hint', role: 'presentation', text: o.foot }));
      active = items.length ? 0 : -1;
      highlight();
      list.hidden = items.length === 0 && !o.hint && !o.foot;
    }
    function highlight() {
      list.querySelectorAll('[role=option]').forEach((li) => li.setAttribute('aria-selected', String(+li.dataset.i === active)));
      if (active >= 0) input.setAttribute('aria-activedescendant', `${role}-opt-${active}`);
      else input.removeAttribute('aria-activedescendant');
    }
    // ricerca indirizzi su richiesta (OpenStreetMap non permette l'autocompletamento)
    async function runAddr() {
      const q = input.value.trim();
      addrNote = 'Cerco l’indirizzo…';
      refresh();
      if (ctl) ctl.abort();
      ctl = new AbortController();
      const res = await searchAddress(q, ctl.signal);
      if (input.value.trim() !== q) return;
      addr = res;
      addrNote = res.length ? null : addrBlocked
        ? 'La ricerca degli indirizzi non funziona in questa pagina. Usa la palina, il nome della fermata o tocca la mappa.'
        : `Nessun indirizzo trovato per «${q}».`;
      refresh();
    }
    function choose(i) {
      const p = items[i];
      if (!p) return;
      if (p.kind === 'addr-search') { runAddr(); return; }
      list.hidden = true;
      setPalMode(false);
      setPlace(role, p);
    }
    function refresh() {
      const q = input.value.trim();
      if (palMode) {
        const digits = q.replace(/\D/g, '');
        if (!digits) { addr = []; render([], { hint: 'Scrivi il numero che leggi sul cartello della fermata.' }); return; }
        const hits = searchPaline(digits);
        render(hits, { hint: hits.length ? null : `Nessuna palina con il numero ${digits}.` });
        return;
      }
      if (!q) { addr = []; render(recents(), { heading: 'Recenti' }); return; }
      const res = searchPlaces(q);
      const pal = norm(q).match(PAL_RE);
      const canAddr = !pal && q.length >= 4 && !addrBlocked && !addr.length && !addrNote;
      render(res, {
        hint: pal && !res.length ? `Nessuna palina con il numero ${pal[1]}.` : null,
        action: canAddr ? { kind: 'addr-search', label: 'Cerca l’indirizzo su OpenStreetMap', sub: `«${q}»` } : null,
        foot: addrNote,
      });
    }
    palBtn.addEventListener('click', () => {
      setPalMode(!palMode);
      if (palMode) { input.value = ''; state[role] = null; hideExample(); }
      input.focus();
      refresh();
    });
    input.addEventListener('input', () => {
      state[role] = null;
      hideExample();
      const q = input.value.trim();
      if (q !== lastQ) { addr = []; addrNote = null; lastQ = q; if (ctl) ctl.abort(); }
      refresh();
    });
    input.addEventListener('focus', () => { if (net) { input.select(); refresh(); } });
    input.addEventListener('blur', () => setTimeout(() => {
      if (document.activeElement === input) return;
      list.hidden = true;
      if (palMode && document.activeElement !== palBtn) setPalMode(false);
    }, 150));
    // il pulsante palina non toglie il fuoco al campo (la tastiera resta aperta)
    palBtn.addEventListener('pointerdown', (e) => { if (document.activeElement === input) e.preventDefault(); });
    input.addEventListener('keydown', (e) => {
      if (list.hidden) return;
      if (e.key === 'ArrowDown') { active = Math.min(items.length - 1, active + 1); highlight(); e.preventDefault(); }
      else if (e.key === 'ArrowUp') { active = Math.max(0, active - 1); highlight(); e.preventDefault(); }
      else if (e.key === 'Enter' && active >= 0) { e.preventDefault(); choose(active); }
      else if (e.key === 'Escape') { list.hidden = true; }
    });
    list.addEventListener('pointerdown', (e) => e.preventDefault());
    list.addEventListener('click', (e) => {
      const li = e.target.closest('[role=option]');
      if (li) choose(+li.dataset.i);
    });
    return {
      resolve() {
        if (state[role]) return true;
        const q = input.value.trim();
        if (!q) return false;
        const best = addr[0] || searchPlaces(q)[0];
        if (best) { state[role] = best; input.value = placeText(best); setPalMode(false); return true; }
        return false;
      },
    };
  }

  // ---------- posizione ----------
  function useGPS(auto) {
    if (!navigator.geolocation) { if (!auto) gpsFail(); return; }
    if (!auto) setMsg('Cerco la tua posizione…');
    navigator.geolocation.getCurrentPosition((pos) => {
      const { latitude: lat, longitude: lon } = pos.coords;
      const near = net.nearestStop(lat, lon);
      if (!near || near.d > 20000) { setMsg('Sei fuori dalla zona servita da GTT. Scegli la partenza a mano.'); return; }
      setMsg('');
      map.setGps(lat, lon);
      setPlace('from', { kind: 'gps', label: 'La mia posizione', sub: `vicino a ${net.name[near.s]}`, lat, lon });
    }, () => { if (!auto) gpsFail(); }, { enableHighAccuracy: true, timeout: 12000, maximumAge: 60000 });
  }
  function gpsFail() {
    setMsg('Non riesco a leggere la tua posizione da questa pagina. Tocca la mappa nel punto in cui sei, oppure scrivi la fermata o la via più vicina.');
    startPick('from');
  }

  function startPick(role) {
    state.pick = role;
    const hint = $('map-hint');
    hint.textContent = role === 'from' ? 'Tocca la mappa nel punto da cui parti' : 'Tocca la mappa nel punto in cui vuoi arrivare';
    hint.style.color = 'var(--accent)';
    if (window.matchMedia('(max-width: 899px)').matches) $('map-wrap').scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
  function endPick() {
    state.pick = null;
    const hint = $('map-hint');
    hint.textContent = 'Tocca la mappa per scegliere da dove parti o dove arrivi';
    hint.style.color = '';
  }

  // ---------- orario della ricerca ----------
  function queryTime() {
    if (state.when === 'now') return { ...romeNow(), now: true };
    const d = $('when-date').value, t = $('when-time').value;
    if (!d || !t) return { ...romeNow(), now: true };
    const [y, m, dd] = d.split('-').map(Number);
    const [hh, mm] = t.split(':').map(Number);
    return { y, m, d: dd, secs: hh * 3600 + mm * 60, now: false };
  }

  // ---------- ricerca e risultati ----------
  function plan() {
    if (!net) return;
    if (!state.from || !state.to) { renderIdle(); return; }
    const q = queryTime();
    const day = net.dayIndex(q.y, q.m, q.d);
    const res = net.plan({ from: state.from, to: state.to, day, time: q.secs });
    state.result = res; state.q = q; state.sel = 0;
    renderResults();
    map.setJourney(res.journeys[0] || null);
    map.fitJourney();
    if (!state.example) { remember(state.from); remember(state.to); }
  }

  function select(i) {
    state.sel = i;
    renderResults();
    map.setJourney(state.result.journeys[i]);
    map.fitJourney();
  }

  function renderIdle() {
    const box = $('results');
    box.replaceChildren(h('p', { class: 'empty' },
      h('strong', { text: 'Scegli partenza e arrivo. ' }),
      'Puoi scrivere il nome di una fermata, il numero della palina o una via, oppure toccare la mappa.'));
  }

  function whenText(q) {
    if (q.now) return `partenza adesso, ${hm(q.secs)}`;
    return `partenza ${pad(q.d)}/${pad(q.m)} alle ${hm(q.secs)}`;
  }

  function renderResults() {
    const box = $('results');
    const { result: res, q } = state;
    box.replaceChildren();
    box.append(h('div', { class: 'results-head' },
      h('h2', { text: 'Come ci arrivi' }),
      h('p', { text: whenText(q) })));
    const js = res.journeys;
    if (!js.length) {
      const f = net.feed;
      const why = {
        outside: `Gli orari caricati valgono dal ${ymdLabel(f.start)} al ${ymdLabel(f.end)}. Scegli un giorno in questo periodo.`,
        noAccess: 'Non ci sono fermate GTT a meno di 2,5 km dalla partenza.',
        noEgress: 'Non ci sono fermate GTT a meno di 2,5 km dall’arrivo.',
      }[res.reason] || 'Nessuna corsa trovata a quest’ora. Di notte passano poche linee: prova a partire più tardi.';
      box.append(h('p', { class: 'empty' }, h('strong', { text: 'Nessun percorso. ' }), why));
      return;
    }
    js.forEach((j, i) => box.append(card(j, i)));
  }

  function card(j, i) {
    const sel = i === state.sel;
    const rides = j.legs.filter((l) => l.type === 'ride');
    const art = h('article', { class: 'trip', 'aria-current': String(sel) });
    const chain = h('div', { class: 'chain', 'aria-hidden': 'true' });
    j.legs.forEach((l, k) => {
      if (l.type === 'walk' && l.dur < 60) return;
      if (chain.childNodes.length) chain.append(h('span', { class: 'sep', text: '›' }));
      if (l.type === 'walk') chain.append(h('span', { class: 'walkchip' }, icon(WALK_SVG), String(Math.round(l.dur / 60))));
      else chain.append(badge(net.routes[l.route]));
    });
    let lead;
    if (!rides.length) {
      lead = h('p', { class: 'lead' }, 'Vai ', h('b', { text: 'a piedi' }), `: ${meters(j.legs[0].dist)}. Arrivi alle `, h('b', { text: hm(j.arrive) }), '.');
    } else {
      const r0 = rides[0], route = net.routes[r0.route];
      lead = h('p', { class: 'lead' }, `Prendi ${noun(route)} `, h('b', { text: route.short }),
        ' alle ', h('b', { text: hm(r0.start) }), ` da ${net.name[r0.from.stop]}. Arrivi alle `, h('b', { text: hm(j.arrive) }), '.');
    }
    const meta = h('p', { class: 'meta' });
    if (state.q.now) {
      const mins = Math.round((j.leave - state.q.secs) / 60);
      meta.append(h('span', { class: mins <= 5 ? 'soon' : null, text: mins <= 0 ? 'Esci adesso' : `Esci fra ${dur(mins * 60)}` }));
    } else meta.append(h('span', { text: `Esci alle ${hm(j.leave)}` }));
    if (rides.length) meta.append(h('span', { text: j.transfers === 0 ? 'Nessun cambio' : j.transfers === 1 ? '1 cambio' : `${j.transfers} cambi` }));
    meta.append(h('span', { text: `A piedi ${dur(j.walk)}` }));

    const sum = h('button', { type: 'button', class: 'trip-sum', 'aria-expanded': String(sel), onclick: () => select(i) },
      h('div', { class: 'trip-top' },
        h('span', { class: 'times' }, hm(j.leave), h('span', { class: 'arrow', text: '→' }), hm(j.arrive)),
        h('span', { class: 'dur', text: dur(j.arrive - j.leave) }),
        i === 0 ? h('span', { class: 'tag', text: 'Consigliato' }) : null),
      chain, lead, meta);
    art.append(sum);
    if (sel) art.append(steps(j));
    return art;
  }

  function stopLine(s) {
    return [net.name[s], ' ', h('span', { class: 'code', text: `· palina ${net.code[s]}` })];
  }

  function steps(j) {
    const ol = h('ol', { class: 'steps' });
    const from = state.from, to = state.to;
    ol.append(h('li', { class: 'step walk start' },
      h('span', { class: 'st-time', text: hm(j.leave) }), h('span', { class: 'st-rail' }),
      h('div', { class: 'st-body' }, h('p', null, h('b', { text: 'Partenza' })), h('p', { class: 'st-sub', text: placeText(from) }))));
    j.legs.forEach((l, k) => {
      if (l.type === 'walk') {
        if (l.dur < 45) return;
        const target = l.to.stop !== undefined ? ['fino alla fermata ', ...stopLine(l.to.stop)] : [`fino a ${to.label}`];
        ol.append(h('li', { class: 'step walk' },
          h('span', { class: 'st-time', text: hm(l.start) }), h('span', { class: 'st-rail' }),
          h('div', { class: 'st-body' },
            h('p', null, h('span', { class: 'walkchip' }, icon(WALK_SVG)), ` A piedi ${dur(l.dur)} (${meters(l.dist)})`),
            h('p', { class: 'st-sub' }, ...target))));
        return;
      }
      const route = net.routes[l.route];
      const rail = `--rail: var(--${mode(route)})`;
      const prev = j.legs[k - 1];
      const waitSec = prev ? l.start - prev.end : 0;
      const mid = [];
      for (let x = 1; x < l.stops.length - 1; x++) mid.push(h('li', null, `${hm(l.times[x])}  ${net.name[l.stops[x]]}`));
      const nStops = l.stops.length - 1;
      ol.append(h('li', { class: 'step ride', style: rail },
        h('span', { class: 'st-time', text: hm(l.start) }), h('span', { class: 'st-rail' }),
        h('div', { class: 'st-body' },
          waitSec >= 120 && k > 0 ? h('p', { class: 'wait', text: `Attesa ${dur(waitSec)}` }) : null,
          h('div', { class: 'st-line' }, badge(route), h('span', { text: `direzione ${l.head}` })),
          h('p', null, 'Sali a ', ...stopLine(l.from.stop)),
          h('details', null,
            h('summary', { text: `${nStops} ${nStops === 1 ? 'fermata' : 'fermate'} · ${dur(l.end - l.start)}` }),
            mid.length ? h('ol', null, mid) : h('p', { class: 'st-sub', text: 'Scendi alla fermata successiva.' })),
          h('a', { class: 'live', href: liveUrl(net.code[l.from.stop]), target: '_blank', rel: 'noopener', text: 'Passaggi in tempo reale a questa fermata (sito GTT)' }))));
      ol.append(h('li', { class: 'step ride', style: rail },
        h('span', { class: 'st-time', text: hm(l.end) }), h('span', { class: 'st-rail' }),
        h('div', { class: 'st-body' }, h('p', null, 'Scendi a ', ...stopLine(l.to.stop)))));
    });
    ol.append(h('li', { class: 'step walk end' },
      h('span', { class: 'st-time', text: hm(j.arrive) }), h('span', { class: 'st-rail' }),
      h('div', { class: 'st-body' }, h('p', null, h('b', { text: 'Arrivo' })), h('p', { class: 'st-sub', text: placeText(to) }))));
    return ol;
  }

  // ---------- mappa ----------
  class MapView {
    constructor(canvas, wrap) {
      this.c = canvas; this.wrap = wrap; this.ctx = canvas.getContext('2d');
      this.lat0 = 45.07; this.lon0 = 7.68;
      this.kx = 111320 * Math.cos(this.lat0 * Math.PI / 180); this.ky = 110574;
      this.cx = 0; this.cy = 0; this.s = 0.1;
      this.pointers = new Map();
      this.journey = null; this.from = null; this.to = null; this.gps = null;
      this.onTap = null; this.onMove = null;
      this.readColors();
      this.bind();
      this.resize();
      const [x, y] = this.ll(45.0703, 7.6869);
      this.cx = x; this.cy = y; this.s = Math.max(0.05, this.W / 9000);
      if (window.ResizeObserver) new ResizeObserver(() => this.resize()).observe(wrap);
      else window.addEventListener('resize', () => this.resize());
      const mq = window.matchMedia('(prefers-color-scheme: dark)');
      const recolor = () => { this.readColors(); this.draw(); };
      if (mq.addEventListener) mq.addEventListener('change', recolor);
      new MutationObserver(recolor).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    }
    readColors() {
      const cs = getComputedStyle(document.documentElement);
      const g = (n) => cs.getPropertyValue(n).trim();
      this.C = {
        bg: g('--map-bg'), net: g('--net'), strong: g('--net-strong'), label: g('--map-label'),
        ink: g('--ink'), surface: g('--surface'), accent: g('--accent'), muted: g('--muted'),
        metro: g('--metro'), tram: g('--tram'), bus: g('--bus'), extra: g('--extra'), tour: g('--tour'),
        body: g('--body') || 'sans-serif',
      };
    }
    ll(lat, lon) { return [(lon - this.lon0) * this.kx, -(lat - this.lat0) * this.ky]; }
    unll(x, y) { return [this.lat0 - y / this.ky, this.lon0 + x / this.kx]; }
    scr(x, y) { return [(x - this.cx) * this.s + this.W / 2, (y - this.cy) * this.s + this.H / 2]; }
    world(px, py) { return [(px - this.W / 2) / this.s + this.cx, (py - this.H / 2) / this.s + this.cy]; }

    setNetwork(n, pl) {
      this.net = n; this.places = pl.slice().sort((a, b) => b.stops.length - a.stops.length);
      this.sx = new Float64Array(n.nStops); this.sy = new Float64Array(n.nStops);
      for (let s = 0; s < n.nStops; s++) { const [x, y] = this.ll(n.lat[s], n.lon[s]); this.sx[s] = x; this.sy[s] = y; }
      const rank = (r) => ({ metro: 4, tram: 3, bus: 2, tour: 2, extra: 1 })[mode(r)];
      const seen = new Map();
      for (const P of n.patterns) {
        const rk = rank(n.routes[P.route]);
        for (let i = 0; i + 1 < P.stops.length; i++) {
          const a = P.stops[i], b = P.stops[i + 1];
          const key = a < b ? a * 8192 + b : b * 8192 + a;
          if ((seen.get(key) || 0) < rk) seen.set(key, rk);
        }
      }
      this.paths = { 1: new Path2D(), 2: new Path2D(), 3: new Path2D(), 4: new Path2D() };
      for (const [key, rk] of seen) {
        const a = Math.floor(key / 8192), b = key % 8192;
        this.paths[rk].moveTo(this.sx[a], this.sy[a]);
        this.paths[rk].lineTo(this.sx[b], this.sy[b]);
      }
      this.draw();
    }
    setEndpoints(f, t) { this.from = f; this.to = t; this.draw(); }
    setJourney(j) { this.journey = j; this.draw(); }
    setGps(lat, lon) { this.gps = [lat, lon]; this.draw(); }
    focus(lat, lon) {
      const [x, y] = this.ll(lat, lon);
      this.cx = x; this.cy = y; this.s = Math.max(this.s, 0.25); this.draw();
    }
    fitJourney() {
      const pts = [];
      if (this.from) pts.push([this.from.lat, this.from.lon]);
      if (this.to) pts.push([this.to.lat, this.to.lon]);
      if (this.journey) for (const l of this.journey.legs) {
        if (l.type === 'ride') for (const s of l.stops) pts.push([this.net.lat[s], this.net.lon[s]]);
      }
      if (!pts.length) return;
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (const [la, lo] of pts) { const [x, y] = this.ll(la, lo); x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
      const padX = Math.min(70, this.W * 0.12), padTop = 60, padBot = 40;
      const w = Math.max(x1 - x0, 300), hh = Math.max(y1 - y0, 300);
      this.s = Math.min((this.W - 2 * padX) / w, (this.H - padTop - padBot) / hh, 0.8);
      this.cx = (x0 + x1) / 2;
      this.cy = (y0 + y1) / 2 - (padTop - padBot) / 2 / this.s;
      this.draw();
    }
    zoomAt(px, py, f) {
      const [wx, wy] = this.world(px, py);
      this.s = Math.min(3, Math.max(0.003, this.s * f));
      this.cx = wx - (px - this.W / 2) / this.s;
      this.cy = wy - (py - this.H / 2) / this.s;
      this.draw();
    }
    resize() {
      this.dpr = Math.min(window.devicePixelRatio || 1, 2.5);
      this.W = Math.max(1, this.wrap.clientWidth); this.H = Math.max(1, this.wrap.clientHeight);
      this.c.width = Math.round(this.W * this.dpr); this.c.height = Math.round(this.H * this.dpr);
      this._draw();
    }
    bind() {
      const c = this.c;
      const pos = (e) => { const r = c.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
      c.addEventListener('pointerdown', (e) => {
        c.setPointerCapture(e.pointerId);
        const [x, y] = pos(e);
        this.pointers.set(e.pointerId, { x, y });
        if (this.pointers.size === 1) this.down = { x, y, t: performance.now(), moved: false };
        else if (this.down) this.down.moved = true;
      });
      c.addEventListener('pointermove', (e) => {
        const p = this.pointers.get(e.pointerId);
        if (!p) return;
        const [x, y] = pos(e);
        if (this.pointers.size === 1) {
          if (this.down && !this.down.moved && Math.hypot(x - this.down.x, y - this.down.y) > 6) { this.down.moved = true; c.classList.add('dragging'); }
          if (!this.down || this.down.moved) {
            this.cx -= (x - p.x) / this.s; this.cy -= (y - p.y) / this.s;
            this.draw(); if (this.onMove) this.onMove();
          }
          p.x = x; p.y = y;
        } else if (this.pointers.size === 2) {
          const [a, b] = [...this.pointers.values()];
          const d0 = Math.hypot(a.x - b.x, a.y - b.y), m0 = [(a.x + b.x) / 2, (a.y + b.y) / 2];
          p.x = x; p.y = y;
          const [a2, b2] = [...this.pointers.values()];
          const d1 = Math.hypot(a2.x - b2.x, a2.y - b2.y), m1 = [(a2.x + b2.x) / 2, (a2.y + b2.y) / 2];
          if (d0 > 0) {
            this.zoomAt(m0[0], m0[1], d1 / d0);
            this.cx -= (m1[0] - m0[0]) / this.s; this.cy -= (m1[1] - m0[1]) / this.s;
            if (this.onMove) this.onMove();
          }
        }
      });
      const up = (e) => {
        if (!this.pointers.has(e.pointerId)) return;
        this.pointers.delete(e.pointerId);
        if (this.pointers.size) return;
        c.classList.remove('dragging');
        const d = this.down;
        this.down = null;
        if (e.type === 'pointerup' && d && !d.moved && performance.now() - d.t < 700) this.tap(d.x, d.y);
      };
      c.addEventListener('pointerup', up);
      c.addEventListener('pointercancel', up);
      c.addEventListener('wheel', (e) => {
        e.preventDefault();
        const [x, y] = pos(e);
        this.zoomAt(x, y, Math.exp(-e.deltaY * (e.deltaMode === 1 ? 0.05 : 0.0015)));
        if (this.onMove) this.onMove();
      }, { passive: false });
    }
    tap(px, py) {
      if (!this.net) return;
      const [wx, wy] = this.world(px, py);
      const [lat, lon] = this.unll(wx, wy);
      const near = this.net.nearStops(lat, lon, 24 / this.s);
      if (this.onTap) this.onTap({ lat, lon, stop: near.length ? near[0].s : null, px, py });
    }
    draw() {
      if (this._raf) return;
      this._raf = requestAnimationFrame(() => { this._raf = 0; this._draw(); });
    }
    _draw() {
      const { ctx, W, H, dpr, s, C } = this;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.fillStyle = C.bg; ctx.fillRect(0, 0, W, H);
      if (!this.net) return;
      ctx.setTransform(dpr * s, 0, 0, dpr * s, dpr * (W / 2 - this.cx * s), dpr * (H / 2 - this.cy * s));
      ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      ctx.globalAlpha = this.journey ? 0.6 : 1;
      const zoomPx = (base) => Math.max(0.6, Math.min(base * 2.2, base * (0.6 + s * 4)));
      const line = (path, color, px) => { ctx.strokeStyle = color; ctx.lineWidth = zoomPx(px) / s; ctx.stroke(path); };
      line(this.paths[1], C.net, 0.9);
      line(this.paths[2], C.net, 1.4);
      line(this.paths[3], C.strong, 1.9);
      line(this.paths[4], C.metro, 3);
      ctx.globalAlpha = 1;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      // fermate
      const [vx0, vy0] = this.world(-20, -20), [vx1, vy1] = this.world(W + 20, H + 20);
      if (s > 0.18) {
        ctx.fillStyle = C.surface; ctx.strokeStyle = C.strong; ctx.lineWidth = 1.2;
        const r = s > 0.5 ? 3 : 2.2;
        for (let i = 0; i < this.net.nStops; i++) {
          const x = this.sx[i], y = this.sy[i];
          if (x < vx0 || x > vx1 || y < vy0 || y > vy1) continue;
          const [px, py] = this.scr(x, y);
          ctx.beginPath(); ctx.arc(px, py, r, 0, 7); ctx.fill(); ctx.stroke();
        }
      }
      // nomi dei luoghi
      const minStops = s > 0.45 ? 1 : s > 0.2 ? 3 : s > 0.08 ? 6 : 99;
      if (minStops < 99) {
        ctx.font = `600 12px ${C.body}`;
        ctx.textBaseline = 'middle';
        ctx.lineWidth = 3; ctx.strokeStyle = C.bg; ctx.fillStyle = C.label;
        const occ = new Set();
        let drawn = 0;
        for (const p of this.places) {
          if (p.stops.length < minStops) break;
          const [x, y] = this.ll(p.lat, p.lon);
          if (x < vx0 || x > vx1 || y < vy0 || y > vy1) continue;
          const [px, py] = this.scr(x, y);
          const w = ctx.measureText(p.label).width;
          const gx0 = Math.floor((px + 6) / 40), gx1 = Math.floor((px + 6 + w) / 40), gy = Math.floor(py / 18);
          let free = true;
          for (let gx = gx0; gx <= gx1 && free; gx++) for (let dy = -1; dy <= 1; dy++) if (occ.has(gx * 1000 + gy + dy)) { free = false; break; }
          if (!free) continue;
          for (let gx = gx0; gx <= gx1; gx++) occ.add(gx * 1000 + gy);
          ctx.strokeText(p.label, px + 6, py); ctx.fillText(p.label, px + 6, py);
          if (++drawn > 160) break;
        }
      }

      // percorso
      const j = this.journey;
      if (j) {
        for (const l of j.legs) {
          if (l.type !== 'walk') continue;
          const [ax, ay] = this.scr(...this.ll(l.from.lat, l.from.lon));
          const [bx, by] = this.scr(...this.ll(l.to.lat, l.to.lon));
          ctx.setLineDash([1, 7]); ctx.lineCap = 'round'; ctx.strokeStyle = C.ink; ctx.lineWidth = 4;
          ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.stroke();
          ctx.setLineDash([]);
        }
        for (const l of j.legs) {
          if (l.type !== 'ride') continue;
          const col = C[mode(this.net.routes[l.route])];
          ctx.beginPath();
          l.stops.forEach((st, i) => { const [x, y] = this.scr(this.sx[st], this.sy[st]); if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y); });
          ctx.lineJoin = 'round'; ctx.lineCap = 'round';
          ctx.strokeStyle = C.surface; ctx.lineWidth = 9; ctx.stroke();
          ctx.strokeStyle = col; ctx.lineWidth = 5; ctx.stroke();
        }
        for (const l of j.legs) {
          if (l.type !== 'ride') continue;
          const col = C[mode(this.net.routes[l.route])];
          for (const st of [l.stops[0], l.stops[l.stops.length - 1]]) {
            const [x, y] = this.scr(this.sx[st], this.sy[st]);
            ctx.beginPath(); ctx.arc(x, y, 6, 0, 7);
            ctx.fillStyle = C.surface; ctx.fill(); ctx.strokeStyle = col; ctx.lineWidth = 3; ctx.stroke();
          }
          const st = l.stops[0];
          const [x, y] = this.scr(this.sx[st], this.sy[st]);
          const label = this.net.routes[l.route].short;
          ctx.font = `700 13px "Barlow Condensed", sans-serif`;
          const w = ctx.measureText(label).width + 10;
          ctx.fillStyle = col;
          ctx.beginPath(); ctx.roundRect ? ctx.roundRect(x + 9, y - 21, w, 18, 3) : ctx.rect(x + 9, y - 21, w, 18); ctx.fill();
          ctx.fillStyle = C.surface; ctx.textBaseline = 'middle'; ctx.fillText(label, x + 14, y - 11.5);
        }
      }
      // GPS e punti di partenza/arrivo
      if (this.gps) {
        const [x, y] = this.scr(...this.ll(this.gps[0], this.gps[1]));
        ctx.beginPath(); ctx.arc(x, y, 14, 0, 7); ctx.fillStyle = C.accent; ctx.globalAlpha = 0.18; ctx.fill(); ctx.globalAlpha = 1;
      }
      if (this.from) {
        const [x, y] = this.scr(...this.ll(this.from.lat, this.from.lon));
        ctx.beginPath(); ctx.arc(x, y, 8, 0, 7);
        ctx.fillStyle = C.surface; ctx.fill(); ctx.strokeStyle = C.accent; ctx.lineWidth = 4; ctx.stroke();
      }
      if (this.to) {
        const [x, y] = this.scr(...this.ll(this.to.lat, this.to.lon));
        ctx.beginPath(); ctx.moveTo(x, y); ctx.arc(x, y - 20, 9, Math.PI * 0.8, Math.PI * 2.2); ctx.closePath();
        ctx.fillStyle = C.accent; ctx.fill(); ctx.strokeStyle = C.surface; ctx.lineWidth = 2; ctx.stroke();
        ctx.beginPath(); ctx.arc(x, y - 20, 3.2, 0, 7); ctx.fillStyle = C.surface; ctx.fill();
      }
      // scala
      const steps = [50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000, 50000];
      const m = steps.find((d) => d * s >= 70) || 50000;
      const len = m * s, x0 = 14, y0 = H - 16;
      ctx.strokeStyle = C.label; ctx.lineWidth = 2; ctx.lineCap = 'butt';
      ctx.beginPath(); ctx.moveTo(x0, y0 - 5); ctx.lineTo(x0, y0); ctx.lineTo(x0 + len, y0); ctx.lineTo(x0 + len, y0 - 5); ctx.stroke();
      ctx.font = `600 11px ${C.body}`; ctx.fillStyle = C.label; ctx.textBaseline = 'bottom';
      ctx.fillText(m >= 1000 ? `${m / 1000} km` : `${m} m`, x0 + 4, y0 - 4);
    }
  }

  // ---------- popup sulla mappa ----------
  const pop = $('map-pop');
  function hidePop() { pop.hidden = true; }
  function onMapTap({ lat, lon, stop, px, py }) {
    const place = stop != null ? stopPlace(stop) : (() => {
      const near = net.nearestStop(lat, lon);
      return { kind: 'map', label: 'Punto sulla mappa', sub: near ? `vicino a ${net.name[near.s]}` : '', lat, lon };
    })();
    if (state.pick) {
      const role = state.pick;
      endPick(); hidePop(); setMsg('');
      setPlace(role, place);
      return;
    }
    pop.replaceChildren(
      h('p', null, placeText(place), h('br'), h('span', { class: 'st-sub', text: place.sub })),
      h('div', { class: 'pop-actions' },
        h('button', { type: 'button', text: 'Parti da qui', onclick: () => { hidePop(); setPlace('from', place); } }),
        h('button', { type: 'button', text: 'Arriva qui', onclick: () => { hidePop(); setPlace('to', place); } })));
    pop.hidden = false;
    const W = map.W, H = map.H;
    const left = Math.max(8, Math.min(W - pop.offsetWidth - 8, px - pop.offsetWidth / 2));
    const top = py + 14 + pop.offsetHeight < H - 8 ? py + 14 : Math.max(8, py - pop.offsetHeight - 14);
    pop.style.left = `${left}px`; pop.style.top = `${top}px`;
  }

  // ---------- avvio ----------
  const map = new MapView($('map'), $('map-wrap'));
  map.onTap = onMapTap;
  map.onMove = hidePop;

  const fields = { from: makeField('from'), to: makeField('to') };

  $('from-gps').addEventListener('click', () => useGPS(false));
  $('to-map').addEventListener('click', () => startPick('to'));
  $('swap').addEventListener('click', () => {
    const f = state.from, t = state.to;
    state.from = t; state.to = f;
    $('from-input').value = t ? placeText(t) : '';
    $('to-input').value = f ? placeText(f) : '';
    hideExample();
    map.setEndpoints(state.from, state.to);
    plan();
  });
  function setWhen(w) {
    state.when = w;
    $('when-now').setAttribute('aria-pressed', String(w === 'now'));
    $('when-later').setAttribute('aria-pressed', String(w === 'at'));
    $('when-at').hidden = w !== 'at';
    plan();
  }
  $('when-now').addEventListener('click', () => setWhen('now'));
  $('when-later').addEventListener('click', () => setWhen('at'));
  $('when-date').addEventListener('change', plan);
  $('when-time').addEventListener('change', plan);
  $('plan').addEventListener('submit', (e) => {
    e.preventDefault();
    if (!net) return;
    const okF = fields.from.resolve(), okT = fields.to.resolve();
    if (!okF) { setMsg('Scegli da dove parti: scrivi una fermata o una via, usa la posizione o tocca la mappa.'); return; }
    if (!okT) { setMsg('Scegli dove vuoi arrivare.'); return; }
    setMsg('');
    map.setEndpoints(state.from, state.to);
    plan();
  });
  $('zoom-in').addEventListener('click', () => { hidePop(); map.zoomAt(map.W / 2, map.H / 2, 1.6); });
  $('zoom-out').addEventListener('click', () => { hidePop(); map.zoomAt(map.W / 2, map.H / 2, 1 / 1.6); });
  $('zoom-fit').addEventListener('click', () => { hidePop(); map.fitJourney(); });

  function findPlace(label) {
    const n = norm(label);
    return places.filter((p) => norm(p.label) === n && p.city === 'Torino').sort((a, b) => b.stops.length - a.stops.length)[0] || searchPlaces(label)[0];
  }

  async function start() {
    let data;
    try {
      const r = await fetch('rete.json');
      if (!r.ok) throw new Error(r.status);
      data = await r.json();
    } catch (e) {
      $('results').replaceChildren(h('p', { class: 'empty' }, h('strong', { text: 'Non riesco a caricare gli orari. ' }), 'Ricarica la pagina tra poco.'));
      return;
    }
    net = new R.Network(data);
    buildPlaces();
    map.setNetwork(net, places);
    const f = net.feed;
    $('feedinfo').textContent = `Torino e provincia · ${net.nStops.toLocaleString('it-IT')} fermate GTT · orari validi fino al ${ymdLabel(f.end)}`;
    const now = romeNow();
    $('when-date').min = ymdIso(f.start); $('when-date').max = ymdIso(f.end);
    $('when-date').value = `${now.y}-${pad(now.m)}-${pad(now.d)}`;
    $('when-time').value = hm(now.secs);

    const a = findPlace('Porta Nuova'), b = findPlace('Politecnico');
    if (a && b) {
      state.example = true; $('example').hidden = false;
      state.from = a; state.to = b;
      $('from-input').value = a.label; $('to-input').value = b.label;
      map.setEndpoints(a, b);
      plan();
    } else renderIdle();

    // se il permesso di posizione e' gia' stato dato, parti da li'
    try {
      if (navigator.permissions && navigator.geolocation) {
        const st = await navigator.permissions.query({ name: 'geolocation' });
        if (st.state === 'granted') useGPS(true);
      }
    } catch (e) { /* niente */ }
  }
  start();
})();
