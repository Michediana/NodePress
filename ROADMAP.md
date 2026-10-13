# NodePress — Roadmap

Obiettivo: un CMS in stile WordPress scritto in Node.js/TypeScript.

## Stack

- **Framework:** React Router v8 in framework mode, SSR su tutte le rotte (front e `/admin`).
- **Backoffice:** tutto sotto `/admin`, UI con shadcn/ui.
- **DB:** MySQL/MariaDB con Drizzle ORM; migrazioni con Drizzle Kit.
- **Editor contenuti:** Tiptap.
- **Immagini:** sharp.

## Decisioni

### Autenticazione, utenti e ruoli
- Login al pannello con email e password, sessione via cookie.
- Reset password via email (SMTP configurabile dalle impostazioni).
- Ruoli fissi:
  - **Admin:** tutto.
  - **Editor:** contenuti, media ed editor visuale dei temi.
  - **Autore:** solo i propri contenuti.

### API REST
- API complete per il front (lettura contenuti) e per il back (admin API).
- Autenticazione con API key create dal pannello, inviate come `Authorization: Bearer <key>` oppure header `X-API-Key`.
- Ogni key ha uno scope: `read` oppure `admin`.
- Le API pubbliche di lettura richiedono una key `read`, salvo un flag "API pubblica" nelle impostazioni.
- Il front SSR legge direttamente dal DB lato server, senza passare dalle API.

### Multilingua
- Attivo da subito.
- Pannello `/admin/settings/languages` per scegliere le lingue attive tra tutte le lingue ISO 639-1, con varianti regionali opzionali (es. `pt-BR`). I nomi vengono da `Intl.DisplayNames`.
- Una **lingua di default**, che non si può disattivare.
- URL:
  - la lingua di default va senza prefisso (`/notizie/notizia1`);
  - le altre lingue hanno il prefisso (`/en/news/news1`).
- L'albero delle rotte è condiviso tra le lingue. Slug, contenuto, dati SEO e voci di menu sono tradotti per ogni lingua.
- Se una traduzione manca, il contenuto non esiste in quella lingua: dà 404 e non compare né nei menu né nella sitemap.
- `hreflang` + `x-default` nell'`<head>` e nella sitemap; componente "selettore lingua" disponibile nei template.
- La UI del pannello resta in italiano, ma con stringhe già predisposte per l'i18n.

### Rotte
- Un unico albero di nodi, annidabile liberamente. L'URL è la concatenazione degli slug.
- Tipi di nodo:
  - **Pagina:** contenuto singolo.
  - **Raccoglitore:** contiene elementi (es. `/notizie/notizia1`), con paginazione (`/notizie?page=2`).
- Ogni nodo sceglie il proprio template; un raccoglitore ne sceglie due, uno per l'elenco e uno per il singolo elemento.
- Se uno slug cambia, si crea in automatico un redirect 301. Sezione "Redirect" gestibile anche a mano.

### Contenuti
- Editor a blocchi su Tiptap. Blocchi: paragrafo, titolo, immagine, galleria, embed, citazione, HTML.
- Il contenuto si salva come JSON e viene renderizzato da React.
- Stati: bozza, pubblicato, programmato (data di pubblicazione futura).
- SEO per contenuto (title, description, slug, OG image, noindex) con punteggio in stile Yoast.

### Temi
- I temi si creano e si modificano a runtime, dal pannello o da CLI, senza ricompilare l'app. Il codice del tema sta nel DB (`theme_files`) e viene compilato a ogni salvataggio.
- **Il server non esegue mai codice del tema, lo interpreta.** Il tema è diviso in tre parti:
  - **Markup:** sintassi JSX "senza JavaScript", compilata in un AST JSON e renderizzata da un interprete React del core, in SSR e in hydration. Navigazione client e `<Link>` continuano a funzionare.
  - **CSS:** scritto a mano (nesting, `@layer`, scope per sezione; Tailwind opzionale), compilato con lightningcss in un file con hash.
  - **JS client:** solo nel browser, bundle con esbuild in un file con hash. Per l'interattività si usano i custom element, che sopravvivono alla navigazione client senza conflitti con React.
- **Formato a file singolo** per le sezioni: frontmatter JSON con lo schema (impostazioni, slot), markup, `<style>` e `<script>`.
- **Whitelist del markup:** tag HTML ammessi (no `<script>`, no attributi `on*`, URL sanificati); componenti del core (`<Link>`, `<Image>`, `<Content>`, `<Menu>`, `<LanguageSwitcher>`, `<Slot>`, `<Pagination>`); espressioni limitate ad accesso a proprietà, letterali, `&&`, `? :`, `.map()` e filtri in whitelist (`date`, `t`, `url`…). Tutto il resto è un errore di compilazione con riga e colonna.
- **Token di design** dichiarati dal tema (colori, font, spaziature…), modificabili dal pannello e scritti come CSS custom properties (`--np-*`). Ordine della cascata: `@layer np.reset, np.core, theme, np.overrides`; il CSS di override scritto nel pannello vince sempre.
- **Composizione:** i template sono alberi di sezioni salvati in JSON, annidabili senza limiti tramite slot, con valori per breakpoint, visibilità condizionale e **data binding** (campi della pagina, elementi di un raccoglitore, menu, query). Gruppi globali per header e footer.
- Il contenuto Tiptap passa per il tema: i blocchi (immagine, galleria, citazione…) sono sovrascrivibili e un blocco "Sezione" inserisce sezioni del tema nel contenuto.
- Il tema non fa query proprie: usa le sorgenti dati esposte dal core.
- Ogni nodo sceglie il proprio template tra quelli del tema attivo; un raccoglitore ne sceglie due, uno per l'elenco e uno per il singolo elemento.
- **Build immutabili** (AST + CSS + JS + token) con stati bozza e pubblicata; pubblicare sposta un puntatore, rollback immediato.
- **Editor di codice:** Monaco nel pannello, con albero dei file, errori di compilazione in linea e anteprima live. In alternativa CLI `np theme pull/push/watch` per lavorare in locale con git. Import/export zip.
- **Editor visuale** in stile Shopify: anteprima del vero front SSR in iframe, albero delle sezioni con drag & drop, inspector generato dallo schema, viewport desktop/tablet/mobile, bozza → pubblica.
- **Sicurezza:**
  - solo gli admin (o la capability "Sviluppatore tema") modificano il codice del tema; gli editor modificano solo composizione e impostazioni;
  - anteprima in iframe sandbox: di default senza script; il JS del tema gira solo se lo attiva l'utente (un iframe `allow-scripts` senza `allow-same-origin` avrebbe un'origine opaca, che rompe hydration, moduli e cookie di anteprima: l'isolamento vero arriva con l'origine separata della 2.6);
  - CSP con nonce sul front, cookie di sessione `HttpOnly` + `SameSite=Strict`, admin su origine separata consigliato in produzione.
- Il CSS del front è separato da quello del pannello.

### Menu
- Menu gestibili dal pannello con voci trascinabili, che puntano a nodi interni o a URL esterni.
- Ogni menu ha una posizione (header, footer…) che i template leggono.
- Le etichette sono tradotte per lingua.

### Media
- Salvati su disco in locale; media library nel pannello.
- Le immagini vengono convertite in automatico in WEBP o AVIF. Il formato è un'impostazione di sistema; qualità di default 80%, modificabile.
- L'originale viene scartato.
- Niente ritagli. Ridimensionamento proporzionale a un lato lungo massimo (default 2560px, configurabile), più varianti a 640 e 1280px per il `srcset`.
- I file non immagine (SVG, PDF, video) si salvano così come sono.

### SEO e indicizzazione
- `sitemap.xml` generata in automatico, multilingua con `hreflang`.
- `robots.txt` e `llms.txt` generati in automatico e modificabili dal pannello.

### Tracking e consenso
- Integrazione nativa di GA4, Google Tag Manager e Microsoft Clarity; gli ID si impostano dal pannello.
- Cookie banner nativo con Google Consent Mode v2. Gli script partono solo dopo il consenso.

### Setup
- Al primo avvio, procedura guidata su `/admin/setup`: crea l'utente admin, il nome del sito e la lingua di default.

## Fasi

### Fase 0 — Fondamenta ✅
- Schema DB + migrazioni Drizzle, configurazione, setup wizard.
- Autenticazione, sessioni, ruoli; layout `/admin` con shadcn.
- Gestione lingue (attive/default) e routing con prefisso lingua.

**Completata quando:** dopo il setup un admin fa login, attiva una seconda lingua e vede il pannello vuoto.

### Fase 1 — MVP ✅
- Albero delle rotte (pagine e raccoglitori), contenuti tradotti, editor Tiptap, stati e programmazione.
- Template React e rendering SSR del front, con paginazione, `hreflang` e selettore lingua.
- Media library con conversione, ridimensionamento e `srcset`.
- Menu, redirect, SEO per contenuto con punteggio.
- sitemap.xml, robots.txt, llms.txt.
- GA4/GTM/Clarity con cookie banner e Consent Mode v2.
- API REST front e admin, gestione API key con scope.
- Gestione utenti, reset password via SMTP.

**Completata quando:** si costruisce un sito bilingue con pagine, una sezione notizie e i menu, indicizzabile e tracciato, interamente dal pannello o via API.

### Fase 2 — Sistema di temi

#### 2.1 — Motore di rendering ✅
- Separazione del CSS di front e pannello.
- Compilatore del markup: parser JSX, validazione della whitelist, AST JSON con errori posizionati.
- Interprete React dell'AST (SSR + hydration) con i componenti del core e i filtri.
- Il template di default attuale (home, articolo, elenco, header/footer) riscritto come tema.

**Completata quando:** il sito di esempio è reso dal tema interpretato, identico all'attuale, con SSR, hydration e navigazione client funzionanti.

#### 2.2 — Pipeline del tema e storage ✅
- Tabelle `themes`, `theme_files`, `theme_builds`, `theme_assets` (asset indirizzati per hash); tema attivo dalle impostazioni.
- Compilazione al salvataggio: CSS con lightningcss, JS con esbuild, token → custom properties; asset con hash serviti con cache immutabile.
- Build bozza/pubblicata, rollback, import/export zip, anteprima della bozza per gli admin (`?np_preview=<tema>`).
- I template disponibili per i nodi vengono dal tema attivo.

**Completata quando:** si modifica un file del tema via API, la build bozza si aggiorna e pubblicandola il front cambia senza riavvio.

#### 2.3 — Editor di codice ✅
- Sezione "Aspetto" nel pannello: elenco dei temi, attivazione, duplicazione.
- Editor Monaco con albero dei file, evidenziazione, autocompletamento di componenti/filtri/variabili, errori di compilazione in linea.
- Anteprima live in iframe sandbox sulla build bozza: di default senza script (`allow-same-origin`, solo HTML del server + CSS), con un interruttore per eseguire anche il JS del tema.

**Completata quando:** un frontend dev crea un tema nuovo da zero dal pannello e lo pubblica.

#### 2.4 — Sezioni, token e composizione ✅
- Sezioni a file singolo con schema, slot, `<style>` con scope, `<script>`.
- Template come alberi JSON di sezioni, gruppi globali header/footer.
- Data binding e sorgenti dati del core (pagina, raccoglitori, menu, query); valori tradotti per lingua nei template JSON.
- Override dei blocchi Tiptap e blocco "Sezione" nell'editor dei contenuti.

**Completata quando:** una home con hero, griglia delle ultime notizie e call to action si compone solo con file del tema e JSON.

#### 2.5 — Editor visuale ✅
- Anteprima del front SSR in iframe senza script, collegata dal pannello (stessa origine): token istantanei, salvataggio automatico e ricarica a doppio buffer per i cambi strutturali.
- Albero delle sezioni con drag & drop, selezione dall'anteprima, inspector generato dallo schema.
- Valori per breakpoint (impostazioni `"responsive"` → variabili CSS `--s-<nome>`), visibilità per dispositivo, lingua e date, viewport, annulla/ripeti, bozza → pubblica con storico e ripristino.
- Le modifiche sono file del tema: template e gruppi JSON, `config/tokens.json`, `config/custom.css`.
- CSS di override globale e per istanza (Monaco).

**Completata quando:** un utente senza codice cambia colori, font e layout della home e pubblica.

#### 2.6 — Strumenti e sicurezza
- CLI `np theme pull/push/watch` con API key. ✅
- Capability "Sviluppatore tema": editor visuale per gli editor, codice per admin e sviluppatori tema, API key con scope `theme`. ✅
- CSP con nonce sul front, con modalità attiva/solo segnalazione/disattivata nelle impostazioni. ✅
- Origine separata per il pannello (opzionale, `ADMIN_URL`), anteprime con token firmato, cookie `SameSite=Strict` e controllo dell'origine sulle scritture. ✅
- Tailwind opzionale nei temi tramite l'API `compile()`.

**Completata quando:** un dev lavora sul tema dal proprio editor con git e le modifiche arrivano in bozza a ogni salvataggio.

### Fase 3 — Estensioni
- Revisioni dei contenuti.
- Campi personalizzati per tipo di raccoglitore.
- Commenti.
- Import da WordPress.
- Sistema di plugin/hook.
