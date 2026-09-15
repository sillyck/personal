# Casa

App de gestio de la llar: tasques recurrents amb recordatoris i un modul de vida proactiva.

Es una web estatica (HTML/CSS/JS sense build) desplegada a GitHub Pages, amb Supabase com a backend i base de dades.

## Posada en marxa (nomes cal fer-ho un cop)

1. Crea un compte gratuit a [supabase.com](https://supabase.com) i un projecte nou.
2. Al projecte, ves a **SQL Editor** i executa el contingut de [`supabase/schema.sql`](supabase/schema.sql). Crea les taules, els permisos i les habitacions inicials.
3. Ves a **Authentication > Users** i crea manualment el teu usuari (correu + contrasenya). L'app nomes te pantalla d'entrada, no de registre, ja que es d'un sol usuari.
4. Ves a **Project Settings > API** i copia la **Project URL** i la clau **anon public** (no la `service_role`, aquesta no s'ha de fer servir mai al frontend).
5. Enganxa aquests dos valors a [`js/config.js`](js/config.js).
6. Fes commit i push. La pagina es publica sola a GitHub Pages en un parell de minuts.

La clau `anon public` esta pensada per ser visible al codi del navegador: la proteccio real de les dades la fan les politiques de Row Level Security del pas 2, que nomes deixen llegir i escriure a usuaris autenticats.
