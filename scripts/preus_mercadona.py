"""Preu per kg/unitat de Mercadona (botiga online, magatzem de Barcelona)."""
import json
import sys
import urllib.request

from comu import UA, carrega_productes, coincideix, desa, millor

URL = "https://tienda.mercadona.es/api/categories/{}/?lang=es&wh=bcn1"


def productes_categoria(cat_id):
    req = urllib.request.Request(URL.format(cat_id), headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=30) as resp:
        dades = json.load(resp)
    return [p for sub in dades.get("categories", []) for p in sub.get("products", [])]


def main():
    productes = carrega_productes()
    categories = {c for p in productes for c in p["mercadona"]["categories"]}
    try:
        cataleg = {c: productes_categoria(c) for c in sorted(categories)}
    except Exception as err:
        print(f"Error llegint Mercadona: {err}", file=sys.stderr)
        return 1

    resultat = {}
    for p in productes:
        cands = []
        for cat_id in p["mercadona"]["categories"]:
            for item in cataleg[cat_id]:
                if coincideix(item["display_name"], p["mercadona"]):
                    pi = item["price_instructions"]
                    cands.append((pi.get("reference_format"), float(pi["reference_price"]), item["display_name"]))
        resultat[p["key"]] = millor(p, cands)
    desa("mercadona", resultat)
    return 0


if __name__ == "__main__":
    sys.exit(main())
