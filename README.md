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
| `themes/` | Temi di partenza, installati nel DB al primo avvio |
| `app/.server/theme/` | Compilatore, build, archivio nel DB e tema attivo |
| `app/components/front/theme/` | Interprete del markup compilato e filtri |
| `app/admin/locales/it.ts` | Stringhe del pannello (predisposte per l'i18n) |

## Temi

Il front è reso dal tema attivo. I temi vivono nel database: si creano e si modificano a runtime, senza ricompilare l'app. Ogni salvataggio di un file ricompila il tema in una **build bozza**. Pubblicando, la bozza diventa la versione visibile sul sito, e le build pubblicate restano nello storico per il rollback.

I temi in `themes/` sono temi di partenza: al primo avvio quello attivo (`default`) viene installato nel DB. Le modifiche successive si fanno dal pannello, in **Aspetto** (`/admin/appearance`), o via API.

L'editor di Aspetto usa Monaco: albero dei file, schede, errori di compilazione sottolineati mentre si scrive, autocompletamento di tag, componenti, filtri, campi di `page`/`site` e token CSS, ⌘S per salvare. Accanto c'è l'anteprima della bozza nel vero front, in un iframe sandbox: di default senza script, con un interruttore per eseguire anche il JS del tema.

```
theme.json          nome, template per tipo di nodo, default, token di design
templates/*.np      template scritti a mano (+ 404.np per le pagine di errore)
templates/*.json    template composti da sezioni (alternativa al .np)
sections/*.np       sezioni: schema nel frontmatter, markup, <style> con scope, <script>
groups/*.json       gruppi di sezioni condivisi (header, footer), inclusi con <Group name="…" />
components/*.np     componenti riusabili: <PostCard item={item} /> → components/PostCard.np
blocks/*.np         ridisegnano i blocchi del contenuto (blockquote, image, gallery…)
styles/*.css        CSS scritto a mano, con nesting; finisce nel layer "theme"
scripts/main.js     punto d'ingresso del JS (o main.ts), impacchettato con esbuild, solo browser
assets/*            font, immagini, SVG: serviti con hash e cache immutabile
```

I file `.np` usano una sintassi JSX "senza JavaScript": tag HTML (con `class` e attributi HTML normali), espressioni `{…}`, `&&`, `? :`, `.map(item => …)`. Il server non esegue mai il codice del tema: lo compila in un AST JSON che React interpreta. Script, eventi `on*`, variabili e funzioni fuori dalla whitelist sono errori di compilazione, con file, riga e colonna.

- **Variabili:** `page` (pagina corrente, `null` nelle pagine di errore), `site` (lingua, menu, nome del sito), `props` e `children` (nei componenti).
- **Componenti del core:** `<Link to>`, `<Image media sizes>`, `<Content />` (il contenuto dell'editor), `<LanguageFlag code>`, `<ConsentLink>`.
- **Filtri:** `date(value, "long")`, `year()`, `menu("header")`, `languages()`, `languageName(code)`, `pageUrl(n)`, `homeUrl()`, `media(id)`, `asset("assets/logo.svg")`.
- **Token:** dichiarati in `theme.json`, disponibili nel CSS come `var(--np-<nome>)`.
- **CSS:** `url("../assets/font.woff2")` viene riscritto con l'URL dell'asset; gli `@import` esterni sono ammessi.
- **JS:** import relativi tra file del tema o da URL `https://`; per l'interattività si usano i custom element.

### Sezioni e template JSON

Una sezione è un file `sections/<tipo>.np` con lo schema nel frontmatter:

```
---
{
  "label": "Hero",
  "settings": {
    "title": { "type": "text", "label": "Titolo" },
    "items": { "type": "items", "default": { "collection": "/novita", "limit": 3 } }
  },
  "slots": { "actions": { "label": "Pulsanti", "accepts": ["button"] } }
}
---
<section class="hero"><h1>{settings.title}</h1><Slot name="actions" /></section>

<style>.hero { padding-block: 4rem; }</style>
```

- **Tipi di impostazione:** `text`, `textarea`, `number`, `boolean`, `select` (con `options`), `color`, `media` (id), `link`, `items` (elementi di un raccoglitore, letti sul server).
- **Stile e script:** il CSS di `<style>` vale solo dentro la sezione (`:scope` indica il contenitore); lo `<script>` finisce nel bundle JS del tema.
- **Template JSON:** `{ "layout": "Layout", "sections": [{ "type": "hero", "settings": {…}, "slots": {…} }] }`. Gli id mancanti si generano dalla posizione.
- **Valori:** fissi (`"Titolo"`), tradotti (`{ "it": "Ciao", "en": "Hello" }`) o legati a un dato (`{ "bind": "page.translation.title" }`).
- **Nel contenuto:** il blocco "Sezione" dell'editor inserisce una sezione del tema con le sue impostazioni (escluse quelle con `"inContent": false`).

Nell'editor di Aspetto i template JSON, i gruppi e `theme.json` sono validati e completati in base alle sezioni del tema.

### Editor visuale

**Aspetto → Personalizza** (`/admin/appearance/<tema>/customize`) compone i template JSON senza scrivere codice: albero delle sezioni con trascinamento e slot, selezione cliccando nell'anteprima, inspector generato dallo schema, token (colori, font, misure) applicati all'istante, CSS globale e per singola sezione, viewport mobile/tablet/desktop, annulla/ripeti, pubblicazione con storico delle versioni.

Le modifiche si salvano da sole nella bozza come file del tema, quindi restano modificabili anche dall'editor del codice:

- template e gruppi: `templates/*.json`, `groups/*.json`;
- token: `config/tokens.json` (sostituisce i default di `theme.json`);
- CSS globale: `config/custom.css`, nel layer `np.overrides` che vince sul CSS del tema.

Per ogni sezione si possono impostare anche:

- **valori per breakpoint** sulle impostazioni dichiarate `"responsive": true` (`{ "base": …, "tablet": …, "desktop": … }`, da 768 e 1024 px), che il CSS della sezione legge con `var(--s-<nome>)`;
- **visibilità**: `"visibility": { "hideOn": ["mobile"], "langs": ["it"], "from": "…", "until": "…" }`;
- **CSS dell'istanza**: `"css": ":scope { … }"`, limitato a quella sezione.

Un admin può vedere la bozza di qualsiasi tema sul sito vero aprendo `/?np_preview=<tema>` (`?np_preview=off` per uscire; l'anteprima scade comunque dopo 30 minuti).

### CLI

Per lavorare su un tema dal proprio editor e con git, `bin/np.ts` sincronizza il tema tra il database e una cartella locale tramite le API REST. Serve una API key con scope `admin` (creata in `/admin/api-keys`); funziona anche verso un'installazione remota. Non ha dipendenze e gira con Node ≥ 22.18, anche copiata fuori dal progetto.

```bash
export NODEPRESS_KEY=np_…        # e NODEPRESS_URL se non è http://localhost:5173
npm run np -- theme pull default ~/temi/default
npm run np -- theme watch ~/temi/default
```

Dentro la cartella del tema si può usare anche `node <percorso>/bin/np.ts theme watch`, senza indicare la cartella.

| Comando | Cosa fa |
| --- | --- |
| `np theme list` | Elenca i temi |
| `np theme create <nome> [cartella]` | Crea un tema (`--label`, `--from <tema>` per duplicarlo) e lo scarica |
| `np theme pull <nome> [cartella]` | Scarica il tema; `pull` senza nome aggiorna una cartella già collegata |
| `np theme push [cartella]` | Carica le modifiche locali nella bozza, con un'unica ricompilazione |
| `np theme watch [cartella]` | `push`, poi carica ogni salvataggio e mostra gli errori di compilazione con file, riga e colonna |
| `np theme publish [cartella]` | Pubblica la bozza |

La cartella ricorda server, tema e stato dell'ultima sincronizzazione in `.nodepress.json` (la key non viene mai salvata; `pull` lo aggiunge a `.gitignore`). La sincronizzazione è a tre vie: un file modificato solo sul server, per esempio dall'editor visuale, non viene sovrascritto da `push` ma segnalato da scaricare con `pull`; se è cambiato da entrambe le parti è un conflitto, e `--force` fa vincere chi scrive (il locale con `push`, il server con `pull`). `push` esce con codice 1 se il tema non compila, quindi `push && publish` pubblica solo una bozza valida.

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
- `GET|POST /api/v1/admin/themes` (POST JSON `{ name, label, from? }` crea o duplica; multipart con campo `file` importa uno zip)
- `GET|PATCH|DELETE /api/v1/admin/themes/:name` (PATCH `{ active: true }` attiva il tema)
- `GET /api/v1/admin/themes/:name/files` (con `?hash` anche lo SHA-256 di ogni file), `GET|PUT|DELETE /api/v1/admin/themes/:name/files/<percorso>` (contenuto grezzo nel body; la risposta riporta la build e l'eventuale errore)
- `POST /api/v1/admin/themes/:name/files`: più file con un'unica ricompilazione; multipart in cui ogni campo file ha come nome il percorso, e i campi `delete` indicano i percorsi da eliminare
- `POST /api/v1/admin/themes/:name/publish` (body opzionale `{ buildId }` per il rollback)
- `GET /api/v1/admin/themes/:name/export` (zip)

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
