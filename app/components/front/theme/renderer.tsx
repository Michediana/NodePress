import { createElement, Fragment, isValidElement, type ReactNode } from "react";
import { Link } from "react-router";
import { LanguageFlag } from "~/components/language-flag";
import type { MediaRef } from "~/lib/media";
import type { ContentNode } from "~/lib/content";
import { embedSrc } from "~/lib/embed";
import { componentPath, FORBIDDEN_PROPS, type Attr, type Expr, type ThemeBundle } from "~/lib/theme/ast";
import {
  isBind,
  isLocalized,
  pickLocalized,
  sectionPath,
  type SectionNode,
  type SectionSchema,
  type SectionTree,
} from "~/lib/theme/sections";
import { isExternalUrl, safeUrl } from "~/lib/url";
import { ConsentPreferencesLink } from "../consent";
import { ContentRenderer } from "../content-renderer";
import { ResponsiveImage } from "../responsive-image";
import { useSite, type SiteData, type TemplatePage } from "../site";
import { filters } from "./filters";

// Interprete dell'AST del tema: valuta le espressioni e produce elementi React.
// La valutazione è "permissiva" come nei linguaggi di template: una proprietà mancante
// vale undefined invece di lanciare un errore, così un dato assente non rompe la pagina.

type Scope = Record<string, unknown>;

type Ctx = { bundle: ThemeBundle; site: SiteData; page: TemplatePage | null; depth: number };

const MAX_DEPTH = 64;

/** Attributi che contengono URL: sanificati a runtime, anche se arrivano da dati o spread. */
const URL_ATTRS = new Set(["href", "src", "poster", "cite", "background", "xlinkHref", "data"]);

const BLOCKED_ATTRS = new Set(["dangerouslySetInnerHTML", "ref", "srcdoc", "srcDoc", "formAction", "action"]);

const RUNTIME_ALIASES: Record<string, string> = { class: "className", for: "htmlFor" };

const NATIVE_METHODS: [(v: unknown) => boolean, object][] = [
  [Array.isArray, Array.prototype],
  [(v) => typeof v === "string", String.prototype],
  [(v) => typeof v === "number", Number.prototype],
];

/** Metodi che modificano l'array: si applicano a una copia, i dati della pagina restano intatti. */
const MUTATING = new Set(["reverse"]);

function getProp(obj: unknown, key: unknown): unknown {
  if (obj === null || obj === undefined) return undefined;
  const name = String(key);
  if (FORBIDDEN_PROPS.has(name)) return undefined;
  if (!Object.hasOwn(Object(obj), name)) return undefined;
  const value = (obj as Record<string, unknown>)[name];
  return typeof value === "function" ? undefined : value;
}

function callMethod(target: unknown, name: string, args: unknown[]): unknown {
  if (target === null || target === undefined) return undefined;
  for (const [test, proto] of NATIVE_METHODS) {
    if (!test(target)) continue;
    const method = (proto as Record<string, unknown>)[name];
    if (typeof method !== "function") return undefined;
    const self = MUTATING.has(name) && Array.isArray(target) ? target.slice() : target;
    try {
      return method.apply(self, args);
    } catch {
      return undefined; // es. map() senza funzione: come una proprietà mancante
    }
  }
  return undefined;
}

/** Converte un valore in un figlio React valido: gli oggetti non renderizzabili spariscono. */
function toNode(value: unknown): ReactNode {
  if (value === null || value === undefined || typeof value === "boolean") return null;
  if (typeof value === "string" || typeof value === "number") return value;
  if (isValidElement(value)) return value;
  if (Array.isArray(value)) {
    return value.map((item, i) =>
      isValidElement(item) && item.key !== null ? item : createElement(Fragment, { key: i }, toNode(item)),
    );
  }
  return null;
}

function parseStyle(style: string) {
  const out: Record<string, string> = {};
  for (const decl of style.split(";")) {
    const i = decl.indexOf(":");
    if (i < 0) continue;
    const prop = decl.slice(0, i).trim();
    const value = decl.slice(i + 1).trim();
    if (!prop || !value) continue;
    out[prop.startsWith("--") ? prop : prop.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase())] = value;
  }
  return out;
}

function sanitizeSrcSet(value: unknown) {
  return String(value ?? "")
    .split(",")
    .map((part) => {
      const [url, ...rest] = part.trim().split(/\s+/);
      return [safeUrl(url), ...rest].join(" ");
    })
    .join(", ");
}

/** Props sicure per un elemento HTML o un custom element. */
function domProps(raw: Record<string, unknown>) {
  const props: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(raw)) {
    const name = RUNTIME_ALIASES[key] ?? key;
    if (/^on/i.test(name) || BLOCKED_ATTRS.has(name) || FORBIDDEN_PROPS.has(name)) continue;
    if (typeof value === "function" || value === undefined) continue;
    if (URL_ATTRS.has(name)) props[name] = safeUrl(value);
    else if (name === "srcSet") props[name] = sanitizeSrcSet(value);
    else if (name === "style") props[name] = typeof value === "string" ? parseStyle(value) : value;
    else props[name] = value;
  }
  return props;
}

function evalAttrs(attrs: Attr[], scope: Scope, ctx: Ctx) {
  const out: Record<string, unknown> = {};
  for (const attr of attrs) {
    if ("spread" in attr) {
      const value = evaluate(attr.spread, scope, ctx);
      if (value && typeof value === "object" && !Array.isArray(value)) {
        for (const [k, v] of Object.entries(value)) if (!FORBIDDEN_PROPS.has(k)) out[k] = v;
      }
    } else {
      out[attr.name] = evaluate(attr.value, scope, ctx);
    }
  }
  return out;
}

const str = (value: unknown) => (value === null || value === undefined ? undefined : String(value));

/** Componenti del core: props in ingresso dal markup, `class` accettato come alias di `className`. */
/** Media per id: prima quelli del contenuto della pagina, poi quelli delle impostazioni delle sezioni. */
function mediaById(ctx: Ctx, id: unknown): MediaRef | null {
  const key = Number(id);
  return ctx.page?.media[key] ?? ctx.bundle.media[key] ?? null;
}

function renderCore(
  tag: string,
  props: Record<string, unknown>,
  children: ReactNode,
  scope: Scope,
  ctx: Ctx,
): ReactNode {
  const className = str(props.className ?? props.class);
  switch (tag) {
    case "Link": {
      const to = safeUrl(props.to ?? props.href) || "#";
      const extra = domProps({ ...props, to: undefined, href: undefined, class: undefined, className: undefined });
      if (isExternalUrl(to)) {
        return createElement(
          "a",
          { ...extra, href: to, className, target: "_blank", rel: "noopener noreferrer" },
          children,
        );
      }
      return createElement(Link, { ...extra, to, className, prefetch: "intent" }, children);
    }
    case "Image": {
      const media = (typeof props.media === "number" ? mediaById(ctx, props.media) : props.media) as
        MediaRef | null | undefined;
      if (!media || typeof media !== "object" || !media.file) return null;
      return createElement(ResponsiveImage, {
        media,
        lang: ctx.site.lang,
        alt: str(props.alt),
        sizes: str(props.sizes),
        className,
        loading: props.loading === "eager" ? "eager" : "lazy",
      });
    }
    case "Content":
      return createElement(ContentRenderer, {
        doc: (props.doc ?? ctx.page?.translation.content ?? null) as never,
        media: (props.media ?? ctx.page?.media ?? {}) as Record<number, MediaRef>,
        lang: ctx.site.lang,
        renderBlock: (node: ContentNode, blockChildren: ReactNode) => renderContentBlock(node, blockChildren, ctx),
      });
    case "Slot": {
      // Le sezioni annidate nello slot della sezione corrente.
      const section = scope.section as { slots?: Record<string, SectionNode[]> } | undefined;
      const nodes = section?.slots?.[String(props.name)] ?? [];
      return nodes.map((node) => renderSection(node, ctx));
    }
    case "Group": {
      const tree = ctx.bundle.trees[`groups/${String(props.name)}.json`];
      return tree ? renderTree(tree, ctx) : null;
    }
    case "LanguageFlag":
      return createElement(LanguageFlag, {
        code: String(props.code ?? ""),
        className: ["np-flag", className].filter(Boolean).join(" "),
      });
    case "ConsentLink":
      return createElement(ConsentPreferencesLink, { className, children });
    default:
      return null;
  }
}

function renderElement(expr: Extract<Expr, { k: "el" }>, scope: Scope, ctx: Ctx): ReactNode {
  const props = evalAttrs(expr.attrs, scope, ctx);
  const children = expr.children.map((child) => toNode(evaluate(child, scope, ctx)));

  // I figli statici vanno passati come argomenti separati, non come array: niente "key" richieste.
  const childNode = children.length ? createElement(Fragment, null, ...children) : null;

  if (expr.kind === "core") return renderCore(expr.tag, props, childNode, scope, ctx);

  if (expr.kind === "theme") {
    const file = ctx.bundle.files[componentPath(expr.tag)];
    if (!file || ctx.depth >= MAX_DEPTH) return null;
    const inner = { ...ctx, depth: ctx.depth + 1 };
    return toNode(evaluate(file.root, { page: ctx.page, site: ctx.site, props, children: childNode }, inner));
  }

  const { key, ...rest } = props;
  return createElement(expr.tag, { ...domProps(rest), key: key === undefined ? undefined : String(key) }, ...children);
}

function evaluate(expr: Expr, scope: Scope, ctx: Ctx): unknown {
  switch (expr.k) {
    case "lit":
      return expr.v;
    case "tpl":
      return expr.quasis.reduce(
        (out, q, i) => out + q + (i < expr.exprs.length ? (str(evaluate(expr.exprs[i], scope, ctx)) ?? "") : ""),
        "",
      );
    case "var":
      return scope[expr.name];
    case "get":
      return getProp(
        evaluate(expr.obj, scope, ctx),
        typeof expr.prop === "string" ? expr.prop : evaluate(expr.prop, scope, ctx),
      );
    case "cond":
      return evaluate(expr.test, scope, ctx) ? evaluate(expr.then, scope, ctx) : evaluate(expr.else, scope, ctx);
    case "logic": {
      const left = evaluate(expr.left, scope, ctx);
      if (expr.op === "&&") return left ? evaluate(expr.right, scope, ctx) : left;
      if (expr.op === "||") return left ? left : evaluate(expr.right, scope, ctx);
      return left ?? evaluate(expr.right, scope, ctx);
    }
    case "bin": {
      const l = evaluate(expr.left, scope, ctx) as any;
      const r = evaluate(expr.right, scope, ctx) as any;
      switch (expr.op) {
        case "===":
          return l === r;
        case "!==":
          return l !== r;
        case "==":
          return l == r;
        case "!=":
          return l != r;
        case "<":
          return l < r;
        case ">":
          return l > r;
        case "<=":
          return l <= r;
        case ">=":
          return l >= r;
        case "+":
          return l + r;
        case "-":
          return l - r;
        case "*":
          return l * r;
        case "/":
          return l / r;
        case "%":
          return l % r;
      }
      return undefined;
    }
    case "unary": {
      const value = evaluate(expr.arg, scope, ctx);
      return expr.op === "!" ? !value : expr.op === "-" ? -(value as number) : +(value as number);
    }
    case "arr":
      return expr.items.map((item) => evaluate(item, scope, ctx));
    case "obj":
      return Object.fromEntries(expr.props.map(([key, value]) => [key, evaluate(value, scope, ctx)]));
    case "filter": {
      const fn = filters[expr.name as keyof typeof filters];
      return fn
        ? fn(
            { site: ctx.site, page: ctx.page, media: (id) => mediaById(ctx, id) },
            ...expr.args.map((a) => evaluate(a, scope, ctx)),
          )
        : undefined;
    }
    case "method":
      return callMethod(
        evaluate(expr.obj, scope, ctx),
        expr.name,
        expr.args.map((a) => evaluate(a, scope, ctx)),
      );
    case "fn":
      return (...args: unknown[]) => {
        const inner: Scope = { ...scope };
        expr.params.forEach((name, i) => (inner[name] = args[i]));
        return evaluate(expr.body, inner, ctx);
      };
    case "el":
      return renderElement(expr, scope, ctx);
    case "frag":
      return createElement(Fragment, null, ...expr.children.map((child) => toNode(evaluate(child, scope, ctx))));
  }
}

// --- Sezioni ---

/** Valore di un percorso puntato (`page.translation.title`) a partire dalle variabili globali. */
function readPath(path: string, scope: Scope): unknown {
  const [head, ...rest] = path.split(".");
  return rest.reduce<unknown>((value, part) => getProp(value, part), scope[head]);
}

/**
 * Impostazioni effettive di una sezione: default dello schema, poi i valori del template
 * (fissi o legati a un dato della pagina), poi i dati calcolati sul server (es. "items").
 */
function resolveSettings(schema: SectionSchema, node: SectionNode, scope: Scope, ctx: Ctx) {
  const settings: Record<string, unknown> = {};
  const computed = ctx.bundle.data[node.id] ?? {};
  for (const [key, def] of Object.entries(schema.settings)) {
    let value = node.settings[key];
    if (isBind(value)) value = readPath(value.bind, scope) ?? value.fallback ?? def.default;
    if (value === undefined || value === null) value = def.default ?? null;
    // Anche i default dello schema possono essere tradotti.
    if (isLocalized(value)) value = pickLocalized(value, ctx.site.lang, ctx.site.defaultLang);
    if (def.type === "items") value = computed[key] ?? [];
    else if (def.type === "media" && typeof value === "number") value = mediaById(ctx, value);
    settings[key] = value;
  }
  return settings;
}

function renderSection(node: SectionNode, ctx: Ctx): ReactNode {
  const schema = ctx.bundle.schemas[node.type];
  const file = ctx.bundle.files[sectionPath(node.type)];
  if (!schema || !file || node.hidden || ctx.depth >= MAX_DEPTH) return null;
  const base: Scope = { page: ctx.page, site: ctx.site, props: {}, children: null };
  const scope: Scope = {
    ...base,
    settings: resolveSettings(schema, node, base, ctx),
    section: { id: node.id, type: node.type, slots: node.slots },
  };
  // Il contenitore porta il tipo (per lo scope del CSS) e l'id (per l'editor visuale).
  return createElement(
    "div",
    { key: node.id, "data-np-section": node.type, "data-np-id": node.id, style: { display: "contents" } },
    toNode(evaluate(file.root, scope, { ...ctx, depth: ctx.depth + 1 })),
  );
}

function renderTree(tree: SectionTree, ctx: Ctx): ReactNode {
  const sections = tree.sections.map((node) => renderSection(node, ctx));
  const layout = tree.layout ? ctx.bundle.files[componentPath(tree.layout)] : null;
  if (!layout) return sections;
  const children = createElement(Fragment, null, ...sections);
  return toNode(
    evaluate(layout.root, { page: ctx.page, site: ctx.site, props: {}, children }, { ...ctx, depth: ctx.depth + 1 }),
  );
}

/** Props passate a `blocks/<tipo>.np` per ogni blocco del contenuto. */
function blockProps(node: ContentNode, ctx: Ctx): Record<string, unknown> {
  const attrs = node.attrs ?? {};
  switch (node.type) {
    case "heading":
      return { level: Math.min(Math.max(Number(attrs.level) || 2, 2), 6) };
    case "orderedList":
      return { start: Number(attrs.start) || 1 };
    case "image":
      return {
        media: mediaById(ctx, attrs.mediaId),
        alt: String(attrs.alt ?? ""),
        caption: String(attrs.caption ?? ""),
      };
    case "gallery":
      return {
        images: ((attrs.images as { mediaId: number }[]) ?? [])
          .map((img) => mediaById(ctx, img.mediaId))
          .filter(Boolean),
      };
    case "embed": {
      const url = String(attrs.url ?? "");
      return { url, src: embedSrc(url) };
    }
    default:
      return {};
  }
}

/**
 * Aggancio del tema nel contenuto: i blocchi con un `blocks/<tipo>.np` usano quel markup,
 * il blocco "Sezione" rende una sezione del tema. `undefined` = rendering standard.
 */
function renderContentBlock(node: ContentNode, children: ReactNode, ctx: Ctx): ReactNode | undefined {
  if (node.type === "section") {
    const attrs = node.attrs ?? {};
    const settings =
      attrs.settings && typeof attrs.settings === "object" ? (attrs.settings as Record<string, unknown>) : {};
    // Le sezioni non pensate per il contenuto (es. header, "contenuto della pagina") non si rendono qui.
    if (ctx.bundle.schemas[String(attrs.section ?? "")]?.inContent === false) return null;
    return renderSection({ id: String(attrs.id ?? ""), type: String(attrs.section ?? ""), settings, slots: {} }, ctx);
  }
  const file = ctx.bundle.files[`blocks/${node.type}.np`];
  if (!file) return undefined;
  const scope: Scope = { page: ctx.page, site: ctx.site, props: blockProps(node, ctx), children };
  return toNode(evaluate(file.root, scope, { ...ctx, depth: ctx.depth + 1 }));
}

/** Renderizza un template del tema compilato (markup `.np` o albero di sezioni). Identico in SSR e nel browser. */
export function ThemeRenderer({
  bundle,
  page,
  props = {},
}: {
  bundle: ThemeBundle;
  page: TemplatePage | null;
  props?: Record<string, unknown>;
}) {
  const site = useSite();
  const ctx: Ctx = { bundle, site, page, depth: 0 };
  const tree = bundle.trees[bundle.entry];
  if (tree) return <>{toNode(renderTree(tree, ctx))}</>;
  const entry = bundle.files[bundle.entry];
  if (!entry) return null;
  return <>{toNode(evaluate(entry.root, { page, site, props, children: null }, ctx))}</>;
}
