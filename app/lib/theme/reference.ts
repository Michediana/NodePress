import { CORE_COMPONENTS, FILTER_NAMES } from "./ast";

// Riferimento del linguaggio dei temi: variabili, filtri e componenti del core, con descrizioni.
// Alimenta autocompletamento e hover dell'editor; tenuto allineato a filters.ts e renderer.tsx.

export type FieldDoc = { doc: string; fields?: Record<string, FieldDoc>; item?: Record<string, FieldDoc> };

const menuItem: Record<string, FieldDoc> = {
  label: { doc: "Etichetta della voce nella lingua corrente." },
  href: { doc: "URL della voce (interno o esterno)." },
  external: { doc: "true se l'URL è esterno." },
  newTab: { doc: "true se va aperta in una nuova scheda." },
  children: { doc: "Sottovoci, con la stessa struttura." },
};

const media: Record<string, FieldDoc> = {
  id: { doc: "Id del media." },
  file: { doc: "Nome del file su disco." },
  mime: { doc: "Tipo MIME." },
  width: { doc: "Larghezza in pixel (immagini)." },
  height: { doc: "Altezza in pixel (immagini)." },
  alt: { doc: "Testi alternativi per lingua: `alt[site.lang]`." },
};

const listingItem: Record<string, FieldDoc> = {
  id: { doc: "Id del nodo." },
  title: { doc: "Titolo." },
  excerpt: { doc: "Riassunto, o null." },
  url: { doc: "URL dell'elemento." },
  publishedAt: { doc: "Data di pubblicazione (ISO), o null. Usa `date(item.publishedAt)`." },
  image: { doc: "Immagine (OG o prima del contenuto), o null. Usa `<Image media={item.image} />`.", fields: media },
};

export const GLOBAL_DOCS: Record<string, FieldDoc> = {
  page: {
    doc: "Pagina corrente. `null` nelle pagine di errore (404.np).",
    fields: {
      lang: { doc: "Lingua della pagina." },
      url: { doc: "URL della pagina (senza ?page)." },
      siteName: { doc: "Nome del sito." },
      siteUrl: { doc: "URL pubblico del sito." },
      node: {
        doc: "Nodo dell'albero.",
        fields: {
          id: { doc: "Id del nodo." },
          type: { doc: '"page", "collection" o "item".' },
          template: { doc: "Nome del template assegnato." },
        },
      },
      translation: {
        doc: "Contenuto nella lingua corrente.",
        fields: {
          title: { doc: "Titolo." },
          excerpt: { doc: "Riassunto, o null." },
          content: { doc: "Contenuto dell'editor (JSON). Renderizzalo con `<Content />`." },
          path: { doc: "Percorso senza prefisso lingua." },
          publishedAt: { doc: "Data di pubblicazione (ISO), o null." },
          updatedAt: { doc: "Data dell'ultima modifica (ISO)." },
          seoTitle: { doc: "Titolo SEO, o null." },
          seoDescription: { doc: "Descrizione SEO, o null." },
          ogImageId: {
            doc: "Id dell'immagine di copertina/OG, o null. Usa `<Image media={page.translation.ogImageId} />`.",
          },
        },
      },
      breadcrumbs: {
        doc: "Briciole di pane: `{ title, href }[]`, dalla radice alla pagina.",
        item: { title: { doc: "Titolo." }, href: { doc: "URL." } },
      },
      alternates: {
        doc: "Traduzioni della pagina: `{ lang, href }[]`.",
        item: { lang: { doc: "Lingua." }, href: { doc: "URL." } },
      },
      listing: {
        doc: "Solo per i raccoglitori: elementi della pagina corrente e paginazione. null altrove.",
        fields: {
          items: { doc: "Elementi della pagina corrente.", item: listingItem },
          page: { doc: "Numero della pagina corrente." },
          pages: { doc: "Numero totale di pagine." },
          total: { doc: "Numero totale di elementi." },
        },
      },
      media: { doc: "Media usati nel contenuto, per id. Usa il filtro `media(id)`." },
    },
  },
  site: {
    doc: "Dati globali del sito.",
    fields: {
      lang: { doc: "Lingua corrente." },
      defaultLang: { doc: "Lingua di default." },
      codes: { doc: "Lingue attive." },
      siteName: { doc: "Nome del sito." },
      menus: { doc: 'Menu per posizione. Usa il filtro `menu("header")`.' },
    },
  },
  props: { doc: 'Attributi passati al componente: `<Card title="…" />` → `props.title`.' },
  children: { doc: "Contenuto passato tra i tag del componente: `<Box>…</Box>`." },
  settings: {
    doc: "Solo nelle sezioni: impostazioni dichiarate nel frontmatter, con default, valori del JSON e dati legati.",
  },
  section: {
    doc: "Solo nelle sezioni: la sezione corrente.",
    fields: { id: { doc: "Id della sezione nel template." }, type: { doc: "Tipo della sezione (nome del file)." } },
  },
};

export type FilterDoc = { signature: string; doc: string; snippet: string; returns?: Record<string, FieldDoc> };

export const FILTER_DOCS: Record<(typeof FILTER_NAMES)[number], FilterDoc> = {
  date: {
    signature: 'date(value, style = "long")',
    doc: "Data localizzata nella lingua corrente. Stili: full, long, medium, short.",
    snippet: "date(${1:page.translation.publishedAt})",
  },
  year: { signature: "year(value?)", doc: "Anno di una data, o l'anno corrente.", snippet: "year()" },
  menu: {
    signature: "menu(location)",
    doc: "Voci del menu assegnato a una posizione.",
    snippet: 'menu("${1:header}")',
    returns: menuItem,
  },
  languages: {
    signature: "languages()",
    doc: "Lingue in cui esiste il contenuto corrente: `{ lang, href, name, current }[]`.",
    snippet: "languages()",
    returns: {
      lang: { doc: "Codice lingua." },
      href: { doc: "URL." },
      name: { doc: "Nome nella lingua stessa." },
      current: { doc: "true se è la lingua corrente." },
    },
  },
  languageName: {
    signature: "languageName(code)",
    doc: "Nome di una lingua nella lingua stessa.",
    snippet: "languageName(${1:site.lang})",
  },
  pageUrl: {
    signature: "pageUrl(n)",
    doc: "URL della pagina n di un elenco paginato.",
    snippet: "pageUrl(${1:page.listing.page + 1})",
  },
  homeUrl: {
    signature: "homeUrl(lang?)",
    doc: "Home della lingua corrente o di quella indicata.",
    snippet: "homeUrl()",
  },
  media: {
    signature: "media(id)",
    doc: "Media del contenuto dato il suo id, o null.",
    snippet: "media(${1:id})",
    returns: media,
  },
  asset: {
    signature: "asset(path)",
    doc: 'URL di un file del tema, es. `asset("assets/logo.svg")`.',
    snippet: 'asset("${1:assets/}")',
  },
};

export type ComponentDoc = { doc: string; props: Record<string, string>; snippet: string };

export const COMPONENT_DOCS: Record<(typeof CORE_COMPONENTS)[number], ComponentDoc> = {
  Link: {
    doc: "Link interno con navigazione client; gli URL esterni si aprono in una nuova scheda.",
    props: { to: "URL di destinazione", class: "Classi CSS" },
    snippet: "Link to={$1}>$2</Link>",
  },
  Image: {
    doc: "Immagine responsive con srcset generato dalle varianti.",
    props: {
      media: "Media (oggetto) o id",
      sizes: "Attributo sizes",
      alt: "Testo alternativo",
      loading: '"lazy" (default) o "eager"',
      class: "Classi CSS",
    },
    snippet: "Image media={$1} />",
  },
  Content: {
    doc: "Contenuto dell'editor a blocchi della pagina corrente.",
    props: { doc: "Documento alternativo (default: page.translation.content)" },
    snippet: "Content />",
  },
  LanguageFlag: {
    doc: "Bandiera di una lingua.",
    props: { code: "Codice lingua", class: "Classi CSS" },
    snippet: "LanguageFlag code={$1} />",
  },
  ConsentLink: {
    doc: "Pulsante che riapre le preferenze cookie (visibile solo se il tracking è attivo).",
    props: { class: "Classi CSS" },
    snippet: "ConsentLink>$1</ConsentLink>",
  },
  Slot: {
    doc: "Solo nelle sezioni: rende le sezioni annidate in uno slot dichiarato nel frontmatter.",
    props: { name: "Nome dello slot (testo fisso)" },
    snippet: 'Slot name="$1" />',
  },
  Group: {
    doc: "Rende un gruppo di sezioni condiviso, da groups/<name>.json (es. header, footer).",
    props: { name: "Nome del gruppo (testo fisso)" },
    snippet: 'Group name="$1" />',
  },
};

/** Tag HTML proposti dall'autocompletamento (la whitelist completa è nel compilatore). */
export const COMMON_TAGS = [
  "div",
  "section",
  "article",
  "header",
  "footer",
  "main",
  "nav",
  "aside",
  "h1",
  "h2",
  "h3",
  "h4",
  "p",
  "a",
  "span",
  "ul",
  "ol",
  "li",
  "img",
  "figure",
  "figcaption",
  "picture",
  "source",
  "video",
  "button",
  "time",
  "strong",
  "em",
  "small",
  "blockquote",
  "table",
  "thead",
  "tbody",
  "tr",
  "th",
  "td",
  "details",
  "summary",
  "svg",
  "path",
];

/** Risolve un percorso puntato (`page.translation`) nel riferimento; `locals` per le variabili di `.map()`. */
export function docAt(path: string[], locals: Record<string, FieldDoc> = {}): FieldDoc | null {
  const [head, ...rest] = path;
  let doc: FieldDoc | undefined = locals[head] ?? GLOBAL_DOCS[head];
  for (const part of rest) doc = doc?.fields?.[part];
  return doc ?? null;
}
