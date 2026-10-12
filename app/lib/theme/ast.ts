import type { MediaRef } from "../media";
import type { SectionSchema, SectionTree } from "./sections";

// AST compilato dei file `.np` del tema: JSON puro, prodotto dal compilatore lato server
// (`app/.server/theme/compile.ts`) e interpretato da `ThemeRenderer`, in SSR e in hydration.
// Non contiene mai codice eseguibile: solo dati.

export type BinaryOp = "===" | "!==" | "==" | "!=" | "<" | ">" | "<=" | ">=" | "+" | "-" | "*" | "/" | "%";
export type LogicalOp = "&&" | "||" | "??";
export type UnaryOp = "!" | "-" | "+";

/** Tipo di tag: HTML, componente del core, componente del tema, custom element. */
export type TagKind = "html" | "core" | "theme" | "custom";

export type Attr = { name: string; value: Expr } | { spread: Expr };

export type Expr =
  | { k: "lit"; v: string | number | boolean | null }
  | { k: "tpl"; quasis: string[]; exprs: Expr[] }
  | { k: "var"; name: string }
  | { k: "get"; obj: Expr; prop: string | Expr; opt?: boolean }
  | { k: "cond"; test: Expr; then: Expr; else: Expr }
  | { k: "logic"; op: LogicalOp; left: Expr; right: Expr }
  | { k: "bin"; op: BinaryOp; left: Expr; right: Expr }
  | { k: "unary"; op: UnaryOp; arg: Expr }
  | { k: "arr"; items: Expr[] }
  | { k: "obj"; props: [string, Expr][] }
  /** Chiamata a un filtro della whitelist, es. `date(page.publishedAt)`. */
  | { k: "filter"; name: string; args: Expr[] }
  /** Metodo della whitelist su array o stringa, es. `items.map(item => …)`. */
  | { k: "method"; obj: Expr; name: string; args: Expr[]; opt?: boolean }
  /** Funzione freccia: ammessa solo come argomento di un metodo. */
  | { k: "fn"; params: string[]; body: Expr }
  | { k: "el"; kind: TagKind; tag: string; attrs: Attr[]; children: Expr[] }
  | { k: "frag"; children: Expr[] };

/** Un file `.np` compilato. */
export type CompiledFile = {
  /** Percorso nel tema, es. `templates/article.np`. */
  path: string;
  root: Expr;
  /** Componenti del tema usati direttamente da questo file (nomi PascalCase). */
  uses: string[];
  /** Gruppi di sezioni inclusi con `<Group name="…" />`. */
  groups: string[];
};

/**
 * Tutto ciò che serve per rendere un template: markup compilato, alberi di sezioni con i loro
 * schemi e i dati risolti sul server (query delle sezioni e media delle impostazioni).
 */
export type ThemeBundle = {
  /** File d'ingresso: `templates/<nome>.np` oppure `templates/<nome>.json`. */
  entry: string;
  files: Record<string, CompiledFile>;
  trees: Record<string, SectionTree>;
  schemas: Record<string, SectionSchema>;
  /** Valori calcolati sul server, per id della sezione e nome dell'impostazione. */
  data: Record<string, Record<string, unknown>>;
  media: Record<number, MediaRef>;
};

/** Metodi ammessi su array e stringhe. */
export const ALLOWED_METHODS = [
  "map",
  "filter",
  "find",
  "some",
  "every",
  "slice",
  "join",
  "includes",
  "indexOf",
  "concat",
  "reverse",
  "at",
  "toUpperCase",
  "toLowerCase",
  "trim",
  "split",
  "startsWith",
  "endsWith",
  "replaceAll",
  "padStart",
  "toFixed",
] as const;

/** Filtri disponibili nelle espressioni (implementati in `app/components/front/theme/filters.ts`). */
export const FILTER_NAMES = [
  "date",
  "year",
  "menu",
  "languages",
  "languageName",
  "pageUrl",
  "homeUrl",
  "media",
  "asset",
] as const;

/** Componenti React del core utilizzabili come tag nel markup. */
export const CORE_COMPONENTS = ["Link", "Image", "Content", "LanguageFlag", "ConsentLink", "Slot", "Group"] as const;

/** Variabili globali sempre disponibili nel markup. */
export const GLOBALS = ["page", "site", "props", "children", "settings", "section"] as const;

/** Proprietà mai accessibili, anche se presenti nei dati. */
export const FORBIDDEN_PROPS = new Set(["__proto__", "prototype", "constructor"]);

export const componentPath = (name: string) => `components/${name}.np`;
