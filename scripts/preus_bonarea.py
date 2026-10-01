"""Preus de BonArea: API JSON de la botiga online (cal la cookie de sessio de /es/shop)."""
import json
import re
import sys
import urllib.parse
import urllib.request
from http.cookiejar import CookieJar

from comu import UA, carrega_productes, coincideix, desa, millor

HOME = "https://www.bonarea-online.com"
ARRELS = ("13*300*010", "13*300*060")  # Carnes y huevos, Fruta y verdura
opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(CookieJar()))
opener.addheaders = [("User-Agent", UA)]


def cos(reference):
    dades = urllib.parse.urlencode({"reference": reference}).encode()
    with opener.open(f"{HOME}/es/shop/ShoppingBody", dades, timeout=30) as resp:
        return json.load(resp)


def fulles(nodes, acum):
    for n in nodes or []:
        fills = n.get("children")
        if fills:
            fulles(fills, acum)
        elif n.get("identifier"):
            acum.append(n["identifier"])
    return acum


def unitat_preu(a):
    m = re.match(r"\s*([\d.,]+)\s*€\s*/\s*(\w+)", a.get("unitPrice") or "")
    if m and m.group(2).lower() == "kg":
        return "kg", float(m.group(1).replace(".", "").replace(",", "."))
    if a.get("priceToPay") and "u" in (a.get("euroUnit") or "").lower():
        return "ud", float(a["priceToPay"])
    return None


def main():
    productes = carrega_productes()
    try:
        with opener.open(f"{HOME}/es/shop", timeout=30) as resp:
            html = resp.read().decode("utf-8", "replace")
        inici = re.search(r'"idNivell":"(13\*300\*\d+)"', html).group(1)
        arbre = cos(inici)["nivells"]
        ids = [i for i in fulles(arbre, []) if i.startswith(ARRELS)]
        articles = {}
        for i in ids:
            for a in cos(i)["articles"]:
                articles[a["identifier"]] = a
    except Exception as err:
        print(f"Error llegint BonArea: {err}", file=sys.stderr)
        return 1

    resultat = {}
    for p in productes:
        cands = []
        for a in articles.values():
            up = unitat_preu(a)
            if up and a.get("itsOnStock") and coincideix(a["description"], p["mercadona"]):
                cands.append((up[0], up[1], a["description"]))
        resultat[p["key"]] = millor(p, cands)
    desa("bonarea", resultat)
    return 0


if __name__ == "__main__":
    sys.exit(main())
