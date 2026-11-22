"""Assembla la pagina: inserisce CSS e JS nel modello HTML.

Produce:
    docs/index.html   il sito (GitHub Pages pubblica la cartella docs/)
    dist/index.html   la stessa pagina per l'Artifact di claude.ai (senza <!doctype>, la aggiunge il servizio)
I dati docs/rete.json vengono copiati anche in dist/.
"""
import hashlib
import json
import os
import shutil

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def read(*p):
    with open(os.path.join(ROOT, *p), encoding="utf-8") as f:
        return f.read()


def write(path, text):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        f.write(text)


page = (read("src", "page.html")
        .replace("/*STYLE*/", read("src", "style.css"))
        .replace("/*ROUTER*/", read("src", "router.js"))
        .replace("/*APP*/", read("src", "app.js")))

site = (
    '<!doctype html>\n<html lang="it">\n<head>\n<meta charset="utf-8">\n'
    '<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">\n'
    '<meta name="theme-color" content="#2a4ba8">\n'
    '<meta name="description" content="Percorsi con bus, tram e metro GTT a Torino: linea da prendere e orario di arrivo.">\n'
    '<link rel="manifest" href="manifest.webmanifest">\n'
    '<link rel="icon" href="icon-192.png">\n'
    '<link rel="apple-touch-icon" href="icon-180.png">\n'
    '<meta name="apple-mobile-web-app-capable" content="yes">\n'
    '<meta name="apple-mobile-web-app-title" content="Come ci arrivo">\n'
    '<style>:root{padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px)}'
    '[hidden]{display:none!important}</style>\n'
    '</head>\n<body>\n' + page + '\n</body>\n</html>\n'
)
write(os.path.join(ROOT, "docs", "index.html"), site)
write(os.path.join(ROOT, "dist", "index.html"), page)

data = os.path.join(ROOT, "docs", "rete.json")
if os.path.exists(data):
    shutil.copyfile(data, os.path.join(ROOT, "dist", "rete.json"))

# service worker: la versione cambia quando cambiano pagina, orari o librerie,
# cosi' il telefono scarica la nuova versione e butta la vecchia
FILES = ["index.html", "rete.json", "manifest.webmanifest", "icon-180.png", "icon-192.png", "icon-512.png", "jsQR.js"]
h = hashlib.sha1()
for name in FILES:
    with open(os.path.join(ROOT, "docs", name), "rb") as f:
        h.update(f.read())
sw = read("src", "sw.js").replace("__VERSION__", h.hexdigest()[:12]).replace("__FILES__", json.dumps(["./"] + FILES))
write(os.path.join(ROOT, "docs", "sw.js"), sw)
print("ok: docs/index.html, docs/sw.js, dist/index.html")
