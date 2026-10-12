// Sezioni del tema: schema (frontmatter di `sections/<tipo>.np`) e alberi di sezioni
// (`templates/<nome>.json`, `groups/<nome>.json`, blocchi "Sezione" nel contenuto).

export const SETTING_TYPES = [
  "text",
  "textarea",
  "number",
  "boolean",
  "select",
  "color",
  "media",
  "link",
  "items",
] as const;

export type SettingType = (typeof SETTING_TYPES)[number];

export type SettingOption = { value: string; label: string };

export type SettingDef = {
  type: SettingType;
  label?: string;
  help?: string;
  default?: unknown;
  /** Solo per "select". */
  options?: SettingOption[];
  min?: number;
  max?: number;
  placeholder?: string;
  /**
   * Valore diverso per breakpoint (`{ "base": …, "tablet": …, "desktop": … }`), esposto al CSS
   * della sezione come `var(--s-<nome>)`; `settings.<nome>` vale il valore base.
   */
  responsive?: boolean;
};

/** Breakpoint dei valori responsive e della visibilità per dispositivo (mobile first). */
export const BREAKPOINTS = { tablet: 768, desktop: 1024 } as const;

export type Breakpoint = "base" | keyof typeof BREAKPOINTS;

export type ResponsiveValue = { base?: unknown; tablet?: unknown; desktop?: unknown };

export type Device = "mobile" | "tablet" | "desktop";

/** Condizioni di visibilità di una sezione. */
export type Visibility = {
  /** Dispositivi su cui la sezione è nascosta. */
  hideOn?: Device[];
  /** Lingue in cui la sezione compare (vuoto = tutte). */
  langs?: string[];
  /** Intervallo di date (ISO) in cui la sezione compare. */
  from?: string;
  until?: string;
};

export type SlotDef = { label?: string; /** Tipi di sezione ammessi; vuoto = tutti. */ accepts?: string[] };

export type SectionSchema = {
  /** Tipo della sezione: il nome del file senza estensione. */
  name: string;
  label: string;
  description?: string;
  settings: Record<string, SettingDef>;
  slots: Record<string, SlotDef>;
  /** Se false la sezione non si può inserire nel contenuto con il blocco "Sezione". */
  inContent: boolean;
};

/** Valore legato a un dato della pagina, es. `{ "bind": "page.translation.title" }`. */
export type BindValue = { bind: string; fallback?: unknown };

/** Valore di un'impostazione "items": elementi di un raccoglitore (id del nodo o percorso). */
export type ItemsQuery = { collection: number | string; limit?: number; offset?: number };

export type SectionNode = {
  id: string;
  type: string;
  settings: Record<string, unknown>;
  slots: Record<string, SectionNode[]>;
  hidden?: boolean;
  visibility?: Visibility;
  /** CSS di questa istanza: limitato alla sezione, nel layer degli override. */
  css?: string;
};

export type SectionTree = {
  /** Componente del tema che avvolge le sezioni (es. "Layout"), o null. */
  layout: string | null;
  sections: SectionNode[];
};

export const isBind = (value: unknown): value is BindValue =>
  typeof value === "object" && value !== null && typeof (value as BindValue).bind === "string";

export const sectionPath = (type: string) => `sections/${type}.np`;

const LANG_KEY = /^[a-z]{2,3}(-[A-Za-z0-9]{2,8})?$/;

/** Valore tradotto: `{ "it": "Ciao", "en": "Hello" }` (solo chiavi di lingua e testi). */
export function isLocalized(value: unknown): value is Record<string, string> {
  if (typeof value !== "object" || value === null || Array.isArray(value) || isBind(value)) return false;
  const entries = Object.entries(value);
  return entries.length > 0 && entries.every(([key, text]) => LANG_KEY.test(key) && typeof text === "string");
}

/** Testo nella lingua richiesta, poi in quella di default, poi il primo disponibile. */
export const pickLocalized = (value: Record<string, string>, lang: string, defaultLang: string) =>
  value[lang] ?? value[defaultLang] ?? Object.values(value)[0] ?? "";

export const isResponsive = (value: unknown): value is ResponsiveValue =>
  typeof value === "object" &&
  value !== null &&
  !Array.isArray(value) &&
  "base" in value &&
  Object.keys(value).every((k) => k === "base" || k === "tablet" || k === "desktop");

/** Blocchi del contenuto che un tema può ridisegnare con `blocks/<tipo>.np`. */
export const OVERRIDABLE_BLOCKS = [
  "paragraph",
  "heading",
  "blockquote",
  "bulletList",
  "orderedList",
  "image",
  "gallery",
  "embed",
  "horizontalRule",
] as const;

/** Tutte le sezioni di un albero, anche quelle negli slot. */
export function walkSections(nodes: SectionNode[], visit: (node: SectionNode) => void) {
  for (const node of nodes) {
    visit(node);
    for (const children of Object.values(node.slots)) walkSections(children, visit);
  }
}
