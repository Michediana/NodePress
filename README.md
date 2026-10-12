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
| `app/templates/` | Template React del front |
| `app/admin/locales/it.ts` | Stringhe del pannello (predisposte per l'i18n) |

## Template

I template sono componenti React in `app/templates/`. Per aggiungerne uno:

1. crea il componente (riceve `{ page }`, vedi `app/templates/types.ts`);
2. registra i metadati in `app/templates/registry.ts` (nome, etichetta, tipi di nodo);
3. aggiungi il componente alla mappa in `app/templates/index.ts`.

Nei template sono disponibili `useSite()`, `useMenu("header")`, `<Menu location="header" />`, `<LanguageSwitcher />`, `<ContentRenderer />` e `<ResponsiveImage />` (in `app/components/front/`).

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
