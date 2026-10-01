"""Preus de Bonpreu Esclat. La botiga online esta darrere d'AWS WAF: cal un navegador real
(Playwright) que resolgui el repte; despres l'estat inicial de la pagina de cerca porta els productes."""
import sys
import time
import urllib.parse

from playwright.sync_api import sync_playwright

from comu import UA, carrega_productes, desa, millor, normalitza

SEARCH = "https://www.compraonline.bonpreuesclat.cat/search?q="
EXCLOU = ("fumat", "fumada", "marinad", "empanad", "cuit", "cuinat", "conserva", "congelat", "precuinat", "sec")


def productes_cerca(browser, text):
    """El WAF nomes deixa passar la primera navegacio d'una sessio: cada cerca fa servir un context nou."""
    ctx = browser.new_context(user_agent=UA, locale="ca-ES")
    try:
        page = ctx.new_page()
        page.goto(SEARCH + urllib.parse.quote(text), wait_until="domcontentloaded", timeout=60000)
        page.wait_for_function("window.__INITIAL_STATE__ !== undefined", timeout=60000)
        estat = page.evaluate("window.__INITIAL_STATE__.data.products.productEntities")
        return list((estat or {}).values())
    finally:
        ctx.close()


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
        for p in productes:
            resultat[p["key"]] = None
            for intent in range(3):
                try:
                    resultat[p["key"]] = millor(p, candidats(p, productes_cerca(browser, p["esclat"]["cerca"])))
                    break
                except Exception as err:
                    print(f"  {p['key']} (intent {intent + 1}): {str(err).splitlines()[0]}", file=sys.stderr)
                    time.sleep(10)
            time.sleep(3)
        browser.close()
    if not any(resultat.values()):
        print("Esclat: cap preu (probable bloqueig del WAF); no es toca preus.json", file=sys.stderr)
        return 1
    desa("esclat", resultat)
    return 0


if __name__ == "__main__":
    sys.exit(main())
