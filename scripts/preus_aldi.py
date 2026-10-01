"""Preus d'Aldi: les pagines de categoria porten els productes (Algolia) dins __NEXT_DATA__."""
import json
import re
import sys
import urllib.request

from comu import UA, carrega_productes, coincideix, desa, millor

BASE = "https://www.aldi.es"
NEXT_DATA = re.compile(r'<script id="__NEXT_DATA__"[^>]*>(.*?)</script>', re.S)
N1 = ["fruta-y-verdura", "carne"]


def next_data(path):
    req = urllib.request.Request(BASE + path, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=30) as resp:
        html = resp.read().decode("utf-8", "replace")
    m = NEXT_DATA.search(html)
    return json.loads(m.group(1)) if m else None


def fulles(n1):
    dades = json.dumps(next_data(f"/productos/{n1}.html"))
    return sorted(set(re.findall(rf"/productos/{n1}/[a-z0-9-]+", dades)) - {f"/productos/{n1}/{x}" for x in ("banner", "headline", "live", "open")})


def hits(path):
    dades = next_data(path + ".html")
    if not dades:
        return []
    pp = dades["props"]["pageProps"]
    idx = pp.get("algoliaConfig", {}).get("indexName")
    try:
        return pp["algoliaState"]["initialResults"][idx]["results"][0]["hits"]
    except (KeyError, TypeError, IndexError):
        return []


def preu(hit):
    cp = hit.get("currentPrice")
    if not cp or cp.get("priceValue") is None:
        return None
    for base in cp.get("basePrice") or []:
        if base.get("basePriceScale") == "kg":
            return "kg", float(base["basePriceValue"])
    return "ud", float(cp["priceValue"])


def main():
    productes = carrega_productes()
    try:
        items = {h["objectID"]: h for n1 in N1 for f in fulles(n1) for h in hits(f)}
    except Exception as err:
        print(f"Error llegint Aldi: {err}", file=sys.stderr)
        return 1

    resultat = {}
    for p in productes:
        cands = []
        for h in items.values():
            pr = preu(h)
            if pr and coincideix(h["name"], p["mercadona"]):
                cands.append((pr[0], pr[1], h["name"]))
        resultat[p["key"]] = millor(p, cands)
    desa("aldi", resultat)
    return 0


if __name__ == "__main__":
    sys.exit(main())
