import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { COMPONENT_DOCS, FILTER_DOCS, GLOBAL_DOCS } from "~/lib/theme/reference";
import { OVERRIDABLE_BLOCKS, SETTING_TYPES } from "~/lib/theme/sections";
import { addTool, type McpContext } from "./tools";

// Istruzioni del server (inviate al client all'inizializzazione) e guide consultabili con il tool `guide`.

export function serverInstructions(ctx: McpContext) {
  const common = `NodePress è un CMS: il sito è un albero di nodi multilingua reso da un tema.
Inizia con site_info: lingue, tema attivo, template e sezioni disponibili, permessi della key.
Le modifiche ai temi finiscono in una bozza: il sito cambia solo con theme_publish.
Prima di azioni distruttive (tool con "Elimina", pubblicare il tema attivo, disattivare lingue) chiedi conferma all'utente.
Per dettagli: guide con topic "content" (contenuti e Markdown) o "themes" (linguaggio dei temi).`;
  if (ctx.scope === "theme") return `${common}\nQuesta API key ha scope theme: gestisce solo i temi.`;
  return `${common}
Contenuti: un nodo è una pagina, un raccoglitore (es. /notizie) o un elemento di un raccoglitore (es. un articolo). Ogni nodo ha una traduzione per lingua, con slug, testo e SEO propri; una traduzione mancante significa che il contenuto non esiste in quella lingua.
Il testo si scrive in Markdown (campo markdown); le immagini vanno prima caricate con media_upload e poi inserite con ![alt](media:<id>).
Le nuove traduzioni nascono in bozza: per pubblicarle usa status "published".`;
}

const CONTENT_GUIDE = `# Contenuti di NodePress

## Struttura
- **page**: pagina singola, alla radice o sotto un'altra pagina.
- **collection** (raccoglitore): elenco paginato di elementi, es. /notizie; ha un template per l'elenco e uno per gli elementi.
- **item**: elemento di un raccoglitore, es. /notizie/titolo; eredita il template dal raccoglitore.
- L'URL è la concatenazione degli slug. La lingua di default non ha prefisso (/chi-siamo), le altre sì (/en/about-us).
- Una traduzione si può creare solo se il genitore è tradotto nella stessa lingua.
- La home è la pagina alla radice con slug "".
- Cambiare slug o genitore aggiorna i percorsi dei discendenti e crea redirect 301 automatici.

## Stati
- draft: non visibile. published: visibile (publishedAt = adesso se manca). scheduled: visibile da publishedAt (data futura).

## Markdown
Il campo \`markdown\` viene convertito nel formato dell'editor a blocchi:
- titoli: \`##\`, \`###\`, \`####\` (il titolo h1 è quello della pagina: \`#\` diventa h2);
- **grassetto**, *corsivo*, ~~barrato~~, [link](/percorso-interno) o [link](https://esterno.it);
- elenchi puntati e numerati, > citazioni, --- separatore;
- immagini della media library: \`![Testo alternativo](media:12 "Didascalia facoltativa")\`, su una riga a sé;
- galleria: \`<!-- np:gallery {"images":[{"mediaId":3},{"mediaId":4}]} -->\`;
- video/embed (YouTube, Vimeo…): \`<!-- np:embed {"url":"https://www.youtube.com/watch?v=…"} -->\`;
- sezione del tema nel contenuto: \`<!-- np:section {"id":"s-promo1","section":"cta","settings":{"title":"…"}} -->\` (tipi e impostazioni dalle sezioni del tema con inContent true: site_info e theme_read_files);
- qualunque altro HTML diventa un blocco HTML.
Niente blocchi di codice. content_get restituisce il contenuto nello stesso formato, quindi lettura e riscrittura non perdono blocchi.

## SEO
- seoTitle (30–60 caratteri) e seoDescription (120–160), focusKeyword per l'analisi; content_seo_analysis dà punteggio e suggerimenti.
- ogImageId: immagine social e di copertina (usata anche dai temi negli elenchi).
- noindex esclude il contenuto da motori di ricerca e sitemap.

## Menu
Le voci (menu_save) sono una lista piatta: depth 0 = primo livello, depth 1 = sottovoce della voce precedente. Una voce punta a nodeId (etichetta di default = titolo del contenuto, nascosta nelle lingue in cui il contenuto non esiste) oppure a url.`;

const THEMES_GUIDE = `# Temi di NodePress

Il tema vive nel database ed è compilato a ogni salvataggio. Il server non esegue codice del tema: lo interpreta.

## File
\`\`\`
theme.json          nome, template per tipo di nodo { nome: { label, kinds: ["page"|"listing"|"item"] } }, defaults, token di design
templates/*.np      template scritti a mano (+ 404.np)
templates/*.json    template composti da sezioni: { "layout": "Layout", "sections": [ … ] }
sections/*.np       sezioni: schema JSON nel frontmatter (--- … ---), markup, <style> con scope, <script>
groups/*.json       gruppi di sezioni condivisi (header, footer), inclusi con <Group name="header" />
components/*.np     componenti: <PostCard item={item} /> → components/PostCard.np (props.item, children)
blocks/*.np         ridisegnano i blocchi del contenuto (${OVERRIDABLE_BLOCKS.join(", ")})
styles/*.css        CSS con nesting, nel layer "theme"; Tailwind v4 facoltativo con @import "tailwindcss"
scripts/main.js     JS solo browser (o main.ts), bundle con esbuild; per l'interattività usa i custom element
assets/*            font, immagini, SVG serviti con hash: asset("assets/logo.svg"), url("../assets/f.woff2") nel CSS
config/tokens.json  valori dei token scelti nell'editor visuale; config/custom.css: CSS di override
\`\`\`

## Markup (.np)
JSX "senza JavaScript": tag HTML con \`class\` e attributi normali, espressioni \`{…}\`, \`&&\`, \`? :\`, \`??\`, \`.map(item => …)\`, confronti e aritmetica.
Vietati: <script> nel markup, attributi on*, funzioni e variabili fuori dalla whitelist. Gli errori riportano file, riga e colonna.
Variabili: \`page\` (null nelle pagine di errore), \`site\`, \`props\`/\`children\` nei componenti, \`settings\`/\`section\` nelle sezioni.

## Sezioni
Frontmatter: { "label", "description", "settings": { nome: { "type", "label", "default", "options", "responsive" } }, "slots": { nome: { "label", "accepts": [tipi] } }, "inContent" }.
Tipi di impostazione: ${SETTING_TYPES.join(", ")}. Le impostazioni "responsive" accettano { base, tablet, desktop } e sono lette nel CSS con var(--s-<nome>).
Nel <style> della sezione \`:scope\` è il contenitore. <Slot name="…" /> rende le sezioni figlie.
Nei template JSON un valore può essere fisso, tradotto ({ "it": "Ciao", "en": "Hello" }) o legato ({ "bind": "page.translation.title" }); "items" vuole { "collection": "/novita" o id, "limit": 3 }.
Ogni sezione nel JSON: { "id", "type", "settings", "slots", "hidden", "visibility": { "hideOn": ["mobile"], "langs": ["it"], "from", "until" }, "css": ":scope { … }" }.

## Token
Dichiarati in theme.json (\`"tokens": { "color-bg": { "type": "color", "label": "Sfondo", "default": "#fff" } }\`), nel CSS come var(--np-color-bg). Tipi: color, font, size, number, text.
Cascata: @layer np.reset, np.core, theme, np.overrides.

## Flusso di lavoro consigliato
1. theme_get e theme_read_files per capire il tema (parti dai file esistenti come esempio).
2. theme_check_file per validare un file mentre lo scrivi, poi theme_write_files (più file insieme = una sola build).
3. theme_preview per controllare l'HTML reso con la bozza e ottenere un link da aprire nel browser.
4. theme_publish quando l'utente approva.

Il riferimento completo di variabili, filtri e componenti è nel campo "reference".`;

export function registerGuideTool(server: McpServer) {
  addTool(
    server,
    "guide",
    {
      title: "Guida di NodePress",
      description:
        'Documentazione per lavorare sul sito: topic "content" (struttura, stati, Markdown dei contenuti, SEO, menu) o "themes" (file, linguaggio del markup, sezioni, token, con il riferimento di variabili, filtri e componenti).',
      readOnly: true,
      input: { topic: z.enum(["content", "themes"]) },
    },
    async ({ topic }) => {
      if (topic === "content") return CONTENT_GUIDE;
      return {
        guide: THEMES_GUIDE,
        reference: { variables: GLOBAL_DOCS, filters: FILTER_DOCS, components: COMPONENT_DOCS },
      };
    },
  );
}
