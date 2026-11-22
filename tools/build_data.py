"""Converte il GTFS di GTT in un file JSON compatto per l'app.

Uso:
    python3 tools/build_data.py <cartella_gtfs_estratta> docs/rete.json

Struttura dell'output (tutti gli indici sono posizioni negli array):
    feed:     versione, data inizio/fine validita, numero di giorni
    stops:    code[], name[], desc[], city[], lat[], lon[] (lat/lon * 1e5), wc[]
    routes:   [nome breve, nome lungo, tipo GTFS, agenzia]
    services: per ogni servizio una stringa di '0'/'1', un carattere per giorno
    patterns: corse con la stessa sequenza di fermate, senza sorpassi:
              r = linea, h = destinazione, s = fermate,
              p = profili (differenze in secondi tra fermate consecutive),
              t = corse appiattite [servizio, partenza in secondi, profilo, accessibile, ...]
              (accessibile e stops.wc: 0 non indicato, 1 si', 2 no)
"""
import csv
import datetime as dt
import json
import os
import re
import sys
from collections import defaultdict

SRC, OUT = sys.argv[1], sys.argv[2]


def rows(name):
    with open(os.path.join(SRC, name), encoding="utf-8-sig", newline="") as f:
        yield from csv.DictReader(f)


def secs(hms):
    h, m, s = hms.split(":")
    return int(h) * 3600 + int(m) * 60 + int(s)


SMALL = {"di", "da", "del", "della", "delle", "dei", "degli", "dello", "e",
         "ed", "a", "al", "alla", "alle", "ai", "in", "la", "le", "lo", "il",
         "per", "su", "sul", "sulla", "fs", "fra", "tra"}
KEEP_UPPER = {"fs", "ss", "sp", "sr", "gtt", "m1", "m2", "ii", "iii", "iv",
              "vi", "vii", "viii", "ix", "xi", "xx", "xxv", "xviii", "rai",
              "asl", "itis", "ipsia", "inps", "inail", "cto", "ikea", "ztl"}


ROMAN = re.compile(r"^m{0,3}(cm|cd|d?c{0,3})(xc|xl|l?x{0,3})(ix|iv|v?i{0,3})$")
NOT_ROMAN = {"di", "mi", "li", "ci", "dc", "mix", "mill", "vi"}
ACCENT = {"a": "à", "e": "è", "i": "ì", "o": "ò", "u": "ù"}


def title(s):
    s = re.sub(r"([AEIOUaeiou])'(?=\s|$|[,;)/-])", lambda m: ACCENT[m.group(1).lower()], s.strip())
    out = []
    for i, w in enumerate(re.split(r"(\s+|[-/(),.'])", s.lower())):
        if not w or not w.strip() or re.fullmatch(r"[-/(),.']", w):
            out.append(w)
            continue
        if w in KEEP_UPPER or (len(w) > 1 and w not in NOT_ROMAN and ROMAN.match(w)):
            out.append(w.upper())
        elif w in SMALL and i > 0:
            out.append(w)
        else:
            out.append(w[0].upper() + w[1:])
    res = "".join(out)
    # "C.So" -> "C.so", "L.Go" -> "L.go" (abbreviazioni con il punto)
    return re.sub(r"(\b[A-Z][a-z]?\.)([A-Z])([a-z]{1,2})\b", lambda m: m.group(1) + m.group(2).lower() + m.group(3), res)


ABBR = [
    (r"\bC\.\s*", "Corso "), (r"\bV\.LE\b\s*", "Viale "), (r"\bV\.\s*", "Via "),
    (r"\bP\.ZZA\b\s*", "Piazza "), (r"\bP\.ZA\b\s*", "Piazza "),
    (r"\bP\.LE\b\s*", "Piazzale "), (r"\bP\.TTA\b\s*", "Piazzetta "),
    (r"\bP\.\s*", "Piazza "), (r"\bSTR\.\s*", "Strada "),
    (r"\bL\.GO\b\s*", "Largo "), (r"\bL\.\s*", "Lungo "),
    (r"\bFRAZ\.\s*", "Frazione "), (r"\bBV\.\s*", "Bivio "),
    (r"\bSTAZ\.\s*", "Stazione "), (r"\bOSP\.\s*", "Ospedale "),
    (r"\bN\.\s*", "n. "), (r"\bANG\.\s*", "angolo "),
]


def expand(s):
    s = s.strip()
    for pat, rep in ABBR:
        s = re.sub(pat, rep, s)
    s = re.sub(r"\s+", " ", s).strip()
    return title(s).replace("N. ", "n. ")


feed = next(rows("feed_info.txt"))
start = dt.datetime.strptime(feed["feed_start_date"], "%Y%m%d").date()
end = dt.datetime.strptime(feed["feed_end_date"], "%Y%m%d").date()
ndays = (end - start).days + 1

# --- fermate --------------------------------------------------------------
city = {r["stop_id"]: r["stop_city"] for r in rows("stop_attributes.txt")}
stop_idx = {}
S = {k: [] for k in ("code", "name", "desc", "city", "lat", "lon", "wc")}
for r in rows("stops.txt"):
    if r["location_type"] not in ("", "0"):
        continue
    stop_idx[r["stop_id"]] = len(S["code"])
    name = re.sub(r"^Fermata\s+\S+\s+-\s+", "", r["stop_name"])
    S["code"].append(r["stop_code"])
    S["name"].append(title(name))
    S["desc"].append(expand(r["stop_desc"]) if r["stop_desc"] else "")
    S["city"].append(title(city.get(r["stop_id"], "")))
    S["lat"].append(round(float(r["stop_lat"]) * 1e5))
    S["lon"].append(round(float(r["stop_lon"]) * 1e5))
    S["wc"].append(int(r.get("wheelchair_boarding") or 0))

# --- linee ----------------------------------------------------------------
route_idx = {}
routes = []
for r in rows("routes.txt"):
    route_idx[r["route_id"]] = len(routes)
    routes.append([r["route_short_name"], r["route_long_name"],
                   int(r["route_type"]), r["agency_id"]])

# --- calendari ------------------------------------------------------------
days = defaultdict(lambda: ["0"] * ndays)
for r in rows("calendar.txt"):
    a = dt.datetime.strptime(r["start_date"], "%Y%m%d").date()
    b = dt.datetime.strptime(r["end_date"], "%Y%m%d").date()
    wd = [r[k] == "1" for k in ("monday", "tuesday", "wednesday", "thursday",
                                "friday", "saturday", "sunday")]
    bits = days[r["service_id"]]
    d = max(a, start)
    while d <= min(b, end):
        if wd[d.weekday()]:
            bits[(d - start).days] = "1"
        d += dt.timedelta(days=1)
for r in rows("calendar_dates.txt"):
    d = dt.datetime.strptime(r["date"], "%Y%m%d").date()
    if start <= d <= end:
        days[r["service_id"]][(d - start).days] = "1" if r["exception_type"] == "1" else "0"
svc_idx = {}
services = []
for sid, bits in days.items():
    svc_idx[sid] = len(services)
    services.append("".join(bits))

# --- corse ----------------------------------------------------------------
trips = {r["trip_id"]: r for r in rows("trips.txt")}
seq = defaultdict(list)
for r in rows("stop_times.txt"):
    seq[r["trip_id"]].append((int(r["stop_sequence"]), r["stop_id"], secs(r["departure_time"])))

groups = defaultdict(list)
for tid, st in seq.items():
    tr = trips.get(tid)
    if tr is None or tr["service_id"] not in svc_idx:
        continue
    if "1" not in services[svc_idx[tr["service_id"]]]:
        continue
    st.sort()
    stops_ = tuple(stop_idx[s] for _, s, _ in st)
    times = [t for _, _, t in st]
    key = (route_idx[tr["route_id"]], title(tr["trip_headsign"]), stops_)
    groups[key].append((times, svc_idx[tr["service_id"]], int(tr.get("wheelchair_accessible") or 0)))

patterns = []
for (ri, head, stops_), lst in groups.items():
    lst.sort(key=lambda x: x[0][0])
    subs = []  # ogni sotto-pattern: lista di corse senza sorpassi
    for times, svc, wc in lst:
        for sub in subs:
            last = sub[-1][0]
            if all(a >= b for a, b in zip(times, last)):
                sub.append((times, svc, wc))
                break
        else:
            subs.append([(times, svc, wc)])
    for sub in subs:
        prof_idx = {}
        profs = []
        flat = []
        for times, svc, wc in sub:
            delta = tuple(times[i + 1] - times[i] for i in range(len(times) - 1))
            if delta not in prof_idx:
                prof_idx[delta] = len(profs)
                profs.append(list(delta))
            flat += [svc, times[0], prof_idx[delta], wc]
        patterns.append({"r": ri, "h": head, "s": list(stops_), "p": profs, "t": flat})

out = {
    "feed": {"version": feed["feed_version"], "start": feed["feed_start_date"],
             "end": feed["feed_end_date"], "days": ndays},
    "stops": S, "routes": routes, "services": services, "patterns": patterns,
}
with open(OUT, "w", encoding="utf-8") as f:
    json.dump(out, f, ensure_ascii=False, separators=(",", ":"))

ntrips = sum(len(p["t"]) // 4 for p in patterns)
nprof = sum(len(p["p"]) for p in patterns)
print(f"fermate {len(S['code'])}, linee {len(routes)}, servizi {len(services)}, "
      f"pattern {len(patterns)}, corse {ntrips}, profili {nprof}, "
      f"{os.path.getsize(OUT) / 1e6:.1f} MB")
