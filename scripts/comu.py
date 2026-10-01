"""Utilitats compartides pels scripts de preus."""
import json
import unicodedata
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PRODUCTES = ROOT / "data" / "productes.json"
SORTIDA = ROOT / "data" / "preus.json"
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36"


def normalitza(text):
    sense_accents = unicodedata.normalize("NFD", text or "")
    return "".join(c for c in sense_accents if unicodedata.category(c) != "Mn").lower()


def coincideix(nom, regla):
    """regla: {"inclou": [...], "exclou": [...]}; "a|b" dins d'inclou vol dir a o b."""
    n = normalitza(nom)
    return all(any(alt in n for alt in w.split("|")) for w in regla["inclou"]) and not any(w in n for w in regla["exclou"])


def millor(producte, candidats):
    """candidats: [(unitat, preu, nom)] -> el mes barat amb la unitat del producte."""
    mateixa = [c for c in candidats if c[0] == producte["unitat"]]
    if not mateixa:
        return None
    unitat, preu, nom = min(mateixa, key=lambda c: c[1])
    return {"preu": round(preu, 2), "unitat": unitat, "producte": nom}


def carrega_productes():
    return json.loads(PRODUCTES.read_text(encoding="utf-8"))


def desa(botiga, resultat):
    """Actualitza nomes la clau de la botiga; la resta de preus queden intactes."""
    actual = json.loads(SORTIDA.read_text(encoding="utf-8")) if SORTIDA.exists() else {}
    actual[botiga] = resultat
    actual.setdefault("dates", {})[botiga] = datetime.now(timezone.utc).date().isoformat()
    actual["actualitzat"] = max(actual["dates"].values())
    SORTIDA.write_text(json.dumps(actual, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    trobats = sum(1 for v in resultat.values() if v)
    print(f"{botiga}: {trobats}/{len(resultat)} productes amb preu")
