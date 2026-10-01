"""Preus de Bonpreu Esclat. La botiga online esta darrere d'AWS WAF: cal un navegador real
(Playwright) que resolgui el repte; despres l'estat inicial de la pagina de cerca porta els productes."""
import sys

from playwright.sync_api import sync_playwright

from comu import UA, carrega_productes, desa, millor, normalitza

SEARCH = "https://www.compraonline.bonpreuesclat.cat/search?q="
EXCLOU = ("fumat", "fumada", "marinad", "empanad", "cuit", "cuinat", "conserva", "congelat", "precuinat", "sec")
JS_ESTAT = "() => (window.__INITIAL_STATE__ && window.__INITIAL_STATE__.data.products.productEntities) || null"


def productes_cerca(page, text):
    page.goto(SEARCH + text.replace(" ", "%20"), wait_until="domcontentloaded", timeout=60000)
    page.wait_for_function("window.__INITIAL_STATE__ !== undefined", timeout=45000)
    return list((page.evaluate(JS_ESTAT) or {}).values())


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
        for p in productes:
            resultat[p["key"]] = None
            for intent in range(3):
                try:
                    resultat[p["key"]] = millor(p, candidats(p, productes_cerca(page, p["esclat"]["cerca"])))
                    break
                except Exception as err:
                    print(f"  {p['key']} (intent {intent + 1}): {str(err).splitlines()[0]}", file=sys.stderr)
                    page.wait_for_timeout(20000)
            page.wait_for_timeout(6000)
        browser.close()
    if not any(resultat.values()):
        print("Esclat: cap preu (probable bloqueig del WAF); no es toca preus.json", file=sys.stderr)
        return 1
    desa("esclat", resultat)
    return 0


if __name__ == "__main__":
    sys.exit(main())
