# NodePress

CMS in stile WordPress scritto in Node.js/TypeScript: React Router v8 (SSR), MySQL/MariaDB con Drizzle, editor a blocchi Tiptap, pannello `/admin` con shadcn/ui. Vedi [ROADMAP.md](ROADMAP.md).

## Requisiti

- Node.js 22.22+
- MySQL 8 o MariaDB 10.6+

## Avvio in sviluppo

```bash
npm install
cp .env.example .env   # poi imposta DATABASE_URL e SESSION_SECRET
npm run dev
```

Il database deve esistere (`CREATE DATABASE nodepress CHARACTER SET utf8mb4`). Le migrazioni vengono applicate in automatico alla prima richiesta, oppure a mano con `npm run db:migrate`.

Al primo avvio apri `http://localhost:5173/admin`: la procedura guidata su `/admin/setup` crea l'amministratore, il nome del sito e la lingua di default.

## Struttura

| Percorso | Contenuto |
| --- | --- |
| `app/.server/` | Codice solo server: DB, auth, servizi (nodi, media, menu, redirect, API) |
| `app/.server/db/schema.ts` | Schema Drizzle; dopo una modifica: `npm run db:generate` |
| `drizzle/` | Migrazioni SQL generate |
| `app/routes/admin/` | Pannello di amministrazione |
| `app/routes/api/` | API REST (`/api/v1/...`) |
| `app/routes/front/` | Rendering SSR del sito (tutte le rotte non di sistema) |
| `themes/` | Temi del front (markup `.np` e CSS), compilati a runtime |
| `app/.server/theme/` | Compilatore e caricamento del tema attivo |
| `app/components/front/theme/` | Interprete del markup compilato e filtri |
| `app/admin/locales/it.ts` | Stringhe del pannello (predisposte per l'i18n) |

## Temi

Il front è reso dal tema attivo in `themes/<nome>/` (per ora `default`). I file vengono compilati a runtime e ricompilati quando cambiano: non serve rifare la build dell'app.

```
themes/default/
  theme.json          nome ed etichetta del tema
  templates/*.np      un file per template (default, home, listing, article, 404)
  components/*.np     componenti riusabili: <PostCard item={item} /> → components/PostCard.np
  styles/*.css        CSS scritto a mano, con nesting; finisce nel layer "theme"
```

I file `.np` usano una sintassi JSX "senza JavaScript": tag HTML (con `class` e attributi HTML normali), espressioni `{…}`, `&&`, `? :`, `.map(item => …)`. Il server non esegue mai il codice del tema: lo compila in un AST JSON che React interpreta. Script, eventi `on*`, variabili e funzioni fuori dalla whitelist sono errori di compilazione, con file, riga e colonna.

- **Variabili:** `page` (pagina corrente, `null` nelle pagine di errore), `site` (lingua, menu, nome del sito), `props` e `children` (nei componenti).
- **Componenti del core:** `<Link to>`, `<Image media sizes>`, `<Content />` (il contenuto dell'editor), `<LanguageFlag code>`, `<ConsentLink>`.
- **Filtri:** `date(value, "long")`, `year()`, `menu("header")`, `languages()`, `languageName(code)`, `pageUrl(n)`, `homeUrl()`, `media(id)`.

I template assegnabili ai nodi sono ancora elencati in `app/templates/registry.ts` (dalla fase 2.2 arriveranno dal tema).

## API REST

Autenticazione con API key creata in `/admin/api-keys`, inviata come `Authorization: Bearer <key>` o `X-API-Key: <key>`.

Lettura (scope `read`, oppure libera se "API pubblica" è attiva):

- `GET /api/v1/languages`
- `GET /api/v1/content?path=/en/news/news1`: risolve un URL come il front
- `GET /api/v1/nodes?lang=&type=&parent=&page=&perPage=`
- `GET /api/v1/nodes/:id?lang=`
- `GET /api/v1/nodes/:id/items?lang=&page=`
- `GET /api/v1/menus/:location?lang=`

Gestione (scope `admin`):

- `GET|POST /api/v1/admin/nodes`, `GET|PATCH|DELETE /api/v1/admin/nodes/:id`
- `GET|PUT|DELETE /api/v1/admin/nodes/:id/translations/:lang`
- `GET|POST /api/v1/admin/media` (upload multipart, campo `file`), `GET|PATCH|DELETE /api/v1/admin/media/:id`
- `GET|POST /api/v1/admin/menus`, `GET|PUT|DELETE /api/v1/admin/menus/:id`
- `GET|POST /api/v1/admin/redirects`, `PATCH|DELETE /api/v1/admin/redirects/:id`
- `GET|POST|PATCH|DELETE /api/v1/admin/languages`
- `GET|PATCH /api/v1/admin/settings`
- `GET|POST /api/v1/admin/users`

Esempio:

```bash
curl -X POST http://localhost:5173/api/v1/admin/nodes \
  -H "Authorization: Bearer $NODEPRESS_KEY" -H "Content-Type: application/json" \
  -d '{"type":"page","parentId":null,"translations":{"it":{"title":"Chi siamo","slug":"chi-siamo","status":"published"}}}'
```

## Produzione

```bash
npm run build
npm run start
```

Con Docker: `docker build -t nodepress .` e poi `docker run -p 3000:3000 --env-file .env -v nodepress-media:/app/storage nodepress`. In produzione il cookie di sessione è `Secure`: serve HTTPS.
