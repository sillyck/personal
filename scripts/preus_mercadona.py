"""Actualitza data/preus.json amb el preu per kg (o per unitat) de Mercadona.

Nomes llegeix les 6 categories publiques de la botiga online (magatzem de
Barcelona). Si alguna peticio falla, surt amb error i no toca el fitxer.
"""
import json
import sys
import unicodedata
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PRODUCTES = ROOT / "data" / "productes.json"
SORTIDA = ROOT / "data" / "preus.json"
URL = "https://tienda.mercadona.es/api/categories/{}/?lang=es&wh=bcn1"
UA = "Mozilla/5.0 (compatible; casa-preus/1.0; +https://github.com/sillyck/personal)"


def normalitza(text):
    sense_accents = unicodedata.normalize("NFD", text)
    return "".join(c for c in sense_accents if unicodedata.category(c) != "Mn").lower()


def productes_categoria(cat_id):
    req = urllib.request.Request(URL.format(cat_id), headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=30) as resp:
        dades = json.load(resp)
    return [p for sub in dades.get("categories", []) for p in sub.get("products", [])]


def millor_preu(producte, cataleg):
    regla = producte["mercadona"]
    candidats = []
    for cat_id in regla["categories"]:
        for p in cataleg[cat_id]:
            nom = normalitza(p["display_name"])
            if all(any(alt in nom for alt in w.split("|")) for w in regla["inclou"]) and not any(w in nom for w in regla["exclou"]):
                pi = p["price_instructions"]
                candidats.append((pi.get("reference_format"), float(pi["reference_price"]), p["display_name"]))
    mateixa_unitat = [c for c in candidats if c[0] == producte["unitat"]]
    triats = mateixa_unitat or candidats
    if not triats:
        return None
    unitat, preu, nom = min(triats, key=lambda c: c[1])
    return {"preu": round(preu, 2), "unitat": unitat, "producte": nom}


def main():
    productes = json.loads(PRODUCTES.read_text(encoding="utf-8"))
    categories = {c for p in productes for c in p["mercadona"]["categories"]}
    try:
        cataleg = {c: productes_categoria(c) for c in sorted(categories)}
    except Exception as err:
        print(f"Error llegint Mercadona: {err}", file=sys.stderr)
        return 1

    resultat = {
        "actualitzat": datetime.now(timezone.utc).date().isoformat(),
        "mercadona": {p["key"]: millor_preu(p, cataleg) for p in productes},
    }
    SORTIDA.write_text(json.dumps(resultat, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    trobats = sum(1 for v in resultat["mercadona"].values() if v)
    print(f"Mercadona: {trobats}/{len(productes)} productes amb preu")
    return 0


if __name__ == "__main__":
    sys.exit(main())
