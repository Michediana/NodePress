import { Parser, type Node as AcornNode } from "acorn";
import jsx from "acorn-jsx";
import {
  ALLOWED_METHODS,
  CORE_COMPONENTS,
  FILTER_NAMES,
  FORBIDDEN_PROPS,
  GLOBALS,
  type Attr,
  type BinaryOp,
  type CompiledFile,
  type Expr,
  type LogicalOp,
  type TagKind,
  type UnaryOp,
} from "~/lib/theme/ast";

// Compilatore dei file `.np`: markup in sintassi JSX "senza JavaScript".
// Il sorgente viene analizzato con acorn-jsx e ogni nodo è validato contro una whitelist:
// tutto ciò che non è previsto è un errore di compilazione, con riga e colonna.

const JsxParser = Parser.extend(jsx());

export class ThemeCompileError extends Error {
  constructor(
    message: string,
    public file: string,
    public line: number,
    public column: number,
  ) {
    super(`${file}:${line}:${column} — ${message}`);
    this.name = "ThemeCompileError";
  }
}

/** Tag HTML (e SVG) ammessi. Esclusi script, iframe, object, embed, form, base, meta, link, style. */
const HTML_TAGS = new Set(
  (
    "a abbr address article aside audio b bdi bdo blockquote br button caption cite code col colgroup data dd del " +
    "details dfn dialog div dl dt em fieldset figcaption figure footer h1 h2 h3 h4 h5 h6 header hgroup hr i img " +
    "input ins kbd label legend li main mark menu meter nav ol optgroup option output p picture pre progress q rp " +
    "rt ruby s samp search section select small source span strong sub summary sup table tbody td template textarea " +
    "tfoot th thead time tr track u ul var video wbr " +
    "svg g path circle ellipse line polyline polygon rect text tspan defs use symbol clipPath mask pattern " +
    "linearGradient radialGradient stop title desc"
  ).split(" "),
);

/** Attributi HTML in minuscolo → nome della prop React. */
const ATTR_ALIASES: Record<string, string> = {
  class: "className",
  for: "htmlFor",
  tabindex: "tabIndex",
  readonly: "readOnly",
  maxlength: "maxLength",
  minlength: "minLength",
  colspan: "colSpan",
  rowspan: "rowSpan",
  srcset: "srcSet",
  crossorigin: "crossOrigin",
  autocomplete: "autoComplete",
  autoplay: "autoPlay",
  autofocus: "autoFocus",
  playsinline: "playsInline",
  referrerpolicy: "referrerPolicy",
  datetime: "dateTime",
  enterkeyhint: "enterKeyHint",
  inputmode: "inputMode",
  contenteditable: "contentEditable",
  spellcheck: "spellCheck",
  fetchpriority: "fetchPriority",
  hreflang: "hrefLang",
  accesskey: "accessKey",
  usemap: "useMap",
  novalidate: "noValidate",
};

const FORBIDDEN_ATTRS = new Set([
  "dangerouslySetInnerHTML",
  "ref",
  "srcdoc",
  "srcDoc",
  "formaction",
  "formAction",
  "action",
]);

const BINARY_OPS = new Set<string>(["===", "!==", "==", "!=", "<", ">", "<=", ">=", "+", "-", "*", "/", "%"]);
const LOGICAL_OPS = new Set<string>(["&&", "||", "??"]);
const UNARY_OPS = new Set<string>(["!", "-", "+"]);
const METHODS = new Set<string>(ALLOWED_METHODS);
const FILTERS = new Set<string>(FILTER_NAMES);
const CORE = new Set<string>(CORE_COMPONENTS);

// Tipi ESTree minimi usati dal compilatore (acorn non esporta tipi per i nodi JSX).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type N = AcornNode & Record<string, any>;

const camel = (name: string) => name.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());

/** Pulizia degli spazi nel testo JSX, con le stesse regole di Babel/TypeScript. */
function cleanJsxText(value: string) {
  const lines = value.split(/\r\n|\n|\r/);
  let lastNonEmpty = 0;
  lines.forEach((line, i) => {
    if (/[^ \t]/.test(line)) lastNonEmpty = i;
  });
  let out = "";
  lines.forEach((line, i) => {
    let text = line.replace(/\t/g, " ");
    if (i !== 0) text = text.replace(/^ +/, "");
    if (i !== lines.length - 1) text = text.replace(/ +$/, "");
    if (text) {
      if (i !== lastNonEmpty) text += " ";
      out += text;
    }
  });
  return out;
}

/** Sostituisce un intervallo con spazi, conservando gli a capo (righe e colonne restano invariate). */
const blank = (text: string) => text.replace(/[^\n]/g, " ");

/** Separa il frontmatter JSON (`---` … `---`) e toglie i commenti HTML. */
/** Blocco `<style>` o `<script>` di un file `.np`, con la riga in cui inizia il suo contenuto. */
export type EmbeddedBlock = { content: string; line: number };

const lineAt = (text: string, index: number) => text.slice(0, index).split("\n").length;

/**
 * Separa il frontmatter JSON (`---` … `---`), i blocchi `<style>` e `<script>` e i commenti HTML
 * dal markup. Le parti tolte diventano spazi: righe e colonne del markup restano invariate.
 */
export function splitSource(source: string) {
  let meta: unknown = null;
  let body = source;
  const fm = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(source);
  if (fm) {
    meta = fm[1].trim() ? JSON.parse(fm[1]) : null;
    body = blank(fm[0]) + source.slice(fm[0].length);
  }
  body = body.replace(/<!--[\s\S]*?-->/g, blank);
  const extract = (tag: "style" | "script") => {
    let block: EmbeddedBlock | null = null;
    body = body.replace(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, "g"), (match, content: string, offset: number) => {
      if (block) throw new SyntaxError(`Un solo blocco <${tag}> per file.`);
      block = { content, line: lineAt(body, offset + `<${tag}>`.length) };
      return blank(match);
    });
    return block as EmbeddedBlock | null;
  };
  const style = extract("style");
  const script = extract("script");
  return { meta, body, style, script };
}

class Compiler {
  uses = new Set<string>();
  groups = new Set<string>();

  constructor(private file: string) {}

  fail(node: { loc?: { start: { line: number; column: number } } | null } | null, message: string): never {
    const start = node?.loc?.start;
    const line = start?.line ?? 1;
    // Il sorgente è avvolto in `<>`: sulla prima riga le colonne sono spostate di 2.
    const column = (start?.column ?? 0) - (line === 1 ? 2 : 0) + 1;
    throw new ThemeCompileError(message, this.file, line, Math.max(1, column));
  }

  expr(node: N, scope: Set<string>): Expr {
    switch (node.type) {
      case "Literal":
        if (node.regex) this.fail(node, "Le espressioni regolari non sono ammesse.");
        if (typeof node.value === "bigint") this.fail(node, "I BigInt non sono ammessi.");
        return { k: "lit", v: node.value };
      case "TemplateLiteral":
        return {
          k: "tpl",
          quasis: node.quasis.map((q: N) => q.value.cooked ?? ""),
          exprs: node.expressions.map((e: N) => this.expr(e, scope)),
        };
      case "Identifier":
        if (node.name === "undefined") return { k: "lit", v: null };
        if (!scope.has(node.name)) {
          if (FILTERS.has(node.name)) this.fail(node, `"${node.name}" è un filtro: va chiamato, es. ${node.name}(…).`);
          this.fail(node, `Variabile sconosciuta "${node.name}". Disponibili: ${[...scope].join(", ")}.`);
        }
        return { k: "var", name: node.name };
      case "ChainExpression":
        return this.expr(node.expression, scope);
      case "MemberExpression": {
        if (node.object.type === "Super") this.fail(node, "Espressione non ammessa.");
        const obj = this.expr(node.object, scope);
        if (node.computed)
          return { k: "get", obj, prop: this.expr(node.property, scope), opt: node.optional || undefined };
        const name = node.property.name as string;
        if (FORBIDDEN_PROPS.has(name)) this.fail(node.property, `La proprietà "${name}" non è accessibile.`);
        return { k: "get", obj, prop: name, opt: node.optional || undefined };
      }
      case "ConditionalExpression":
        return {
          k: "cond",
          test: this.expr(node.test, scope),
          then: this.expr(node.consequent, scope),
          else: this.expr(node.alternate, scope),
        };
      case "LogicalExpression":
        if (!LOGICAL_OPS.has(node.operator)) this.fail(node, `Operatore "${node.operator}" non ammesso.`);
        return {
          k: "logic",
          op: node.operator as LogicalOp,
          left: this.expr(node.left, scope),
          right: this.expr(node.right, scope),
        };
      case "BinaryExpression":
        if (!BINARY_OPS.has(node.operator)) this.fail(node, `Operatore "${node.operator}" non ammesso.`);
        return {
          k: "bin",
          op: node.operator as BinaryOp,
          left: this.expr(node.left, scope),
          right: this.expr(node.right, scope),
        };
      case "UnaryExpression":
        if (!UNARY_OPS.has(node.operator)) this.fail(node, `Operatore "${node.operator}" non ammesso.`);
        return { k: "unary", op: node.operator as UnaryOp, arg: this.expr(node.argument, scope) };
      case "ArrayExpression":
        return {
          k: "arr",
          items: node.elements.map((el: N | null) => {
            if (!el || el.type === "SpreadElement") this.fail(el ?? node, "Elemento di array non ammesso.");
            return this.expr(el, scope);
          }),
        };
      case "ObjectExpression":
        return {
          k: "obj",
          props: node.properties.map((p: N): [string, Expr] => {
            if (p.type !== "Property" || p.computed || p.kind !== "init" || p.method)
              this.fail(p, "Proprietà di oggetto non ammessa.");
            const key = p.key.type === "Identifier" ? p.key.name : String(p.key.value);
            if (FORBIDDEN_PROPS.has(key)) this.fail(p.key, `La chiave "${key}" non è ammessa.`);
            return [key, this.expr(p.value, scope)];
          }),
        };
      case "CallExpression":
        return this.call(node, scope);
      case "ArrowFunctionExpression":
        this.fail(node, "Le funzioni sono ammesse solo come argomento di un metodo, es. items.map(item => …).");
        break;
      case "JSXElement":
        return this.element(node, scope);
      case "JSXFragment":
        return { k: "frag", children: this.children(node.children, scope) };
      default:
        this.fail(node, `Espressione non ammessa (${node.type}).`);
    }
  }

  call(node: N, scope: Set<string>): Expr {
    const { callee } = node;
    if (callee.type === "Identifier") {
      if (!FILTERS.has(callee.name))
        this.fail(callee, `Filtro sconosciuto "${callee.name}". Disponibili: ${FILTER_NAMES.join(", ")}.`);
      return { k: "filter", name: callee.name, args: node.arguments.map((a: N) => this.arg(a, scope)) };
    }
    if (callee.type === "MemberExpression" && !callee.computed) {
      const name = callee.property.name as string;
      if (!METHODS.has(name))
        this.fail(callee.property, `Metodo "${name}" non ammesso. Disponibili: ${ALLOWED_METHODS.join(", ")}.`);
      return {
        k: "method",
        obj: this.expr(callee.object, scope),
        name,
        args: node.arguments.map((a: N) => this.arg(a, scope)),
        opt: callee.optional || node.optional || undefined,
      };
    }
    this.fail(node, "Chiamata non ammessa: usa un filtro o un metodo della whitelist.");
  }

  arg(node: N, scope: Set<string>): Expr {
    if (node.type === "SpreadElement") this.fail(node, "Lo spread negli argomenti non è ammesso.");
    if (node.type !== "ArrowFunctionExpression") return this.expr(node, scope);
    if (node.async || node.generator) this.fail(node, "Funzione non ammessa.");
    if (node.body.type === "BlockStatement")
      this.fail(node.body, "Il corpo della funzione deve essere un'espressione, senza { }.");
    const params = node.params.map((p: N) => {
      if (p.type !== "Identifier") this.fail(p, "I parametri devono essere nomi semplici.");
      return p.name as string;
    });
    return { k: "fn", params, body: this.expr(node.body, new Set([...scope, ...params])) };
  }

  tagName(node: N): string {
    if (node.type === "JSXIdentifier") return node.name;
    this.fail(node, "Nome di tag non ammesso.");
  }

  element(node: N, scope: Set<string>): Expr {
    const opening = node.openingElement;
    const tag = this.tagName(opening.name);
    let kind: TagKind;
    if (tag.includes("-")) kind = "custom";
    else if (/^[A-Z]/.test(tag)) {
      kind = CORE.has(tag) ? "core" : "theme";
      if (kind === "theme") this.uses.add(tag);
    } else {
      if (!HTML_TAGS.has(tag)) this.fail(opening.name, `Il tag <${tag}> non è ammesso.`);
      kind = "html";
    }
    const attrs = opening.attributes.map((a: N) => this.attr(a, kind, scope));
    if (tag === "Group" || tag === "Slot") {
      // Il nome deve essere una stringa fissa: i gruppi usati si conoscono già in compilazione.
      const name = opening.attributes.find((a: N) => a.type === "JSXAttribute" && a.name.name === "name");
      if (name?.value?.type !== "Literal" || typeof name.value.value !== "string") {
        this.fail(
          opening.name,
          `<${tag}> richiede un attributo name con un testo fisso, es. <${tag} name="header" />.`,
        );
      }
      if (tag === "Group") this.groups.add(name.value.value);
    }
    return { k: "el", kind, tag, attrs, children: this.children(node.children, scope) };
  }

  attr(node: N, kind: TagKind, scope: Set<string>): Attr {
    if (node.type === "JSXSpreadAttribute") return { spread: this.expr(node.argument, scope) };
    let name: string =
      node.name.type === "JSXNamespacedName"
        ? node.name.namespace.name + node.name.name.name.charAt(0).toUpperCase() + node.name.name.name.slice(1)
        : node.name.name;
    if (kind === "html" || kind === "custom") {
      if (/^on/i.test(name))
        this.fail(node.name, `Gli eventi (${name}) non sono ammessi: per l'interattività usa un custom element.`);
      if (FORBIDDEN_ATTRS.has(name)) this.fail(node.name, `L'attributo "${name}" non è ammesso.`);
      if (ATTR_ALIASES[name]) name = ATTR_ALIASES[name];
      else if (kind === "html" && name.includes("-") && !/^(data|aria)-/.test(name)) name = camel(name);
    } else if (kind === "core") {
      // I componenti del core passano gli attributi al DOM: stessi alias dell'HTML, niente eventi.
      if (/^on[A-Z]/.test(name)) this.fail(node.name, `Gli eventi (${name}) non sono ammessi.`);
      if (ATTR_ALIASES[name]) name = ATTR_ALIASES[name];
    }
    if (name === "key" && kind !== "html" && kind !== "custom")
      this.fail(node.name, `"key" è ammesso solo sui tag HTML.`);
    const value = node.value;
    if (value === null) return { name, value: { k: "lit", v: true } };
    if (value.type === "Literal") return { name, value: { k: "lit", v: value.value } };
    if (value.type === "JSXExpressionContainer") {
      if (value.expression.type === "JSXEmptyExpression") this.fail(value, "Espressione vuota.");
      return { name, value: this.expr(value.expression, scope) };
    }
    return { name, value: this.expr(value, scope) };
  }

  children(nodes: N[], scope: Set<string>): Expr[] {
    const out: Expr[] = [];
    for (const child of nodes) {
      if (child.type === "JSXText") {
        const text = cleanJsxText(child.value);
        if (text) out.push({ k: "lit", v: text });
      } else if (child.type === "JSXExpressionContainer") {
        if (child.expression.type !== "JSXEmptyExpression") out.push(this.expr(child.expression, scope));
      } else if (child.type === "JSXSpreadChild") {
        this.fail(child, "Lo spread nei figli non è ammesso.");
      } else {
        out.push(this.expr(child, scope));
      }
    }
    return out;
  }
}

/** Compila il markup di un file `.np` in AST. Lancia `ThemeCompileError` se non valido. */
export type CompiledMarkup = CompiledFile & {
  meta: unknown;
  style: EmbeddedBlock | null;
  script: EmbeddedBlock | null;
};

export function compileMarkup(file: string, source: string): CompiledMarkup {
  let split: ReturnType<typeof splitSource>;
  try {
    split = splitSource(source);
  } catch (error) {
    const message =
      error instanceof SyntaxError && error.message.startsWith("Un solo")
        ? error.message
        : `Frontmatter JSON non valido: ${(error as Error).message}`;
    throw new ThemeCompileError(message, file, 1, 1);
  }
  const code = `<>${split.body}</>`;
  const compiler = new Compiler(file);
  const ast = (() => {
    try {
      return JsxParser.parseExpressionAt(code, 0, { ecmaVersion: "latest", locations: true }) as N;
    } catch (error) {
      const e = error as SyntaxError & { loc?: { line: number; column: number } };
      return compiler.fail({ loc: { start: e.loc ?? { line: 1, column: 0 } } }, e.message.replace(/ \(\d+:\d+\)$/, ""));
    }
  })();
  if (code.slice(ast.end).trim()) compiler.fail(null, "Contenuto non valido dopo la fine del markup.");
  const root = compiler.expr(ast, new Set(GLOBALS));
  return {
    path: file,
    root,
    uses: [...compiler.uses],
    groups: [...compiler.groups],
    meta: split.meta,
    style: split.style,
    script: split.script,
  };
}
