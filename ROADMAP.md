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
  - **Editor:** contenuti e media.
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

### Front e template
- Niente sistema di temi: i template sono componenti React nel progetto (es. `templates/article.tsx`, `templates/listing.tsx`).
- Dal pannello si assegna il template a ogni nodo.

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

### Fase 0 — Fondamenta
- Schema DB + migrazioni Drizzle, configurazione, setup wizard.
- Autenticazione, sessioni, ruoli; layout `/admin` con shadcn.
- Gestione lingue (attive/default) e routing con prefisso lingua.

**Completata quando:** dopo il setup un admin fa login, attiva una seconda lingua e vede il pannello vuoto.

### Fase 1 — MVP
- Albero delle rotte (pagine e raccoglitori), contenuti tradotti, editor Tiptap, stati e programmazione.
- Template React e rendering SSR del front, con paginazione, `hreflang` e selettore lingua.
- Media library con conversione, ridimensionamento e `srcset`.
- Menu, redirect, SEO per contenuto con punteggio.
- sitemap.xml, robots.txt, llms.txt.
- GA4/GTM/Clarity con cookie banner e Consent Mode v2.
- API REST front e admin, gestione API key con scope.
- Gestione utenti, reset password via SMTP.

**Completata quando:** si costruisce un sito bilingue con pagine, una sezione notizie e i menu, indicizzabile e tracciato, interamente dal pannello o via API.

### Fase 2 — Estensioni
- Revisioni dei contenuti.
- Campi personalizzati per tipo di raccoglitore.
- Commenti.
- Import da WordPress.
- Sistema di plugin/hook.
