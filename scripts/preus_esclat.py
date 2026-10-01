"""Preus de Bonpreu Esclat. La botiga online esta darrere d'AWS WAF: cal un navegador real
(Playwright) que resolgui el repte; despres l'estat inicial de la pagina de cerca porta els productes."""
import json
import re
import sys
import urllib.parse

from playwright.sync_api import sync_playwright

from comu import UA, carrega_productes, desa, millor, normalitza

SEARCH = "https://www.compraonline.bonpreuesclat.cat/search?q="
EXCLOU = ("fumat", "fumada", "marinad", "empanad", "cuit", "cuinat", "conserva", "congelat", "precuinat", "sec")


def productes_cerca(page, text):
    """Un cop el navegador ha passat el WAF, les cerques es fan amb fetch dins la mateixa pagina
    (mateixes cookies) i es llegeix l'estat inicial del HTML, sense tornar a navegar."""
    html = page.evaluate("async (u) => { const r = await fetch(u); return r.status + '|' + await r.text(); }", SEARCH + urllib.parse.quote(text))
    estat, _, cos = html.partition("|")
    m = re.search(r"window\.__INITIAL_STATE__\s*=\s*(\{.*?\})\s*;?\s*</script>", cos, re.S)
    if not m:
        raise RuntimeError(f"HTTP {estat}, {len(cos)} bytes sense estat inicial (WAF?)")
    return list(json.loads(m.group(1))["data"]["products"]["productEntities"].values())


def candidats(producte, entitats):
    paraules = normalitza(producte["esclat"]["cerca"]).split()
    cands = []
    for e in entitats:
        if (e.get("categoryPath") or [""])[0] != "Frescos":
            continue
        nom = normalitza(e["name"])
        if not all(w in nom for w in paraules) or any(x in nom for x in EXCLOU):
            continue
        pr = e.get("price") or {}
        unitat = (pr.get("unit") or {}).get("label", "")
        if unitat.endswith("per.kg"):
            cands.append(("kg", float(pr["unit"]["current"]["amount"]), e["name"].strip()))
        elif unitat.endswith("per.each"):
            cands.append(("ud", float(pr["current"]["amount"]), e["name"].strip()))
    return cands


def main():
    productes = carrega_productes()
    resultat = {}
    with sync_playwright() as pw:
        browser = pw.chromium.launch()
        page = browser.new_context(user_agent=UA, locale="ca-ES").new_page()
        page.goto("https://www.compraonline.bonpreuesclat.cat/", wait_until="domcontentloaded", timeout=60000)
        page.wait_for_function("window.__INITIAL_STATE__ !== undefined", timeout=60000)
        for p in productes:
            resultat[p["key"]] = None
            for intent in range(3):
                try:
                    resultat[p["key"]] = millor(p, candidats(p, productes_cerca(page, p["esclat"]["cerca"])))
                    break
                except Exception as err:
                    print(f"  {p['key']} (intent {intent + 1}): {str(err).splitlines()[0]}", file=sys.stderr)
                    page.wait_for_timeout(10000)
            page.wait_for_timeout(2000)
        browser.close()
    if not any(resultat.values()):
        print("Esclat: cap preu (probable bloqueig del WAF); no es toca preus.json", file=sys.stderr)
        return 1
    desa("esclat", resultat)
    return 0


if __name__ == "__main__":
    sys.exit(main())
