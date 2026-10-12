import type * as Monaco from "monaco-editor";
import { ALLOWED_METHODS } from "~/lib/theme/ast";
import { COMMON_TAGS, COMPONENT_DOCS, docAt, FILTER_DOCS, GLOBAL_DOCS, type FieldDoc } from "~/lib/theme/reference";
import type { SectionSchema } from "~/lib/theme/sections";
import { themeJsonSchemas } from "./json-schemas";

// Monaco viene caricato solo nel browser e solo nella pagina dell'editor (import dinamico):
// è pesante e non deve finire nel bundle del resto del pannello.

export type MonacoApi = typeof Monaco;

/** Contesto del tema aperto, letto da autocompletamento, hover e schemi JSON. */
const context = { components: [] as string[], tokens: [] as string[], schemas: {} as Record<string, SectionSchema> };

let api: MonacoApi | null = null;

export function setThemeContext(value: {
  components: string[];
  tokens: string[];
  schemas: Record<string, SectionSchema>;
}) {
  Object.assign(context, value);
  if (api) applyJsonSchemas(api);
}

/** Validazione e completamento di template JSON, gruppi e theme.json. */
function applyJsonSchemas(monaco: MonacoApi) {
  monaco.json.jsonDefaults.setDiagnosticsOptions({
    validate: true,
    enableSchemaRequest: false,
    schemas: themeJsonSchemas(context.schemas, context.components),
  });
}

let loading: Promise<MonacoApi> | null = null;

export function loadMonaco() {
  loading ??= (async () => {
    // Monaco 0.57 crea da solo i worker (new URL(..., import.meta.url)), Vite li impacchetta.
    const monaco = await import("monaco-editor");
    registerNp(monaco);
    registerCssTokens(monaco);
    applyJsonSchemas(monaco);
    api = monaco;
    return monaco;
  })();
  return loading;
}

/** Linguaggio di Monaco per un percorso del tema. */
export function languageOf(path: string) {
  const ext = path.slice(path.lastIndexOf(".")).toLowerCase();
  return (
    {
      ".np": "np",
      ".css": "css",
      ".js": "javascript",
      ".ts": "typescript",
      ".json": "json",
      ".md": "markdown",
      ".svg": "xml",
    }[ext] ?? "plaintext"
  );
}

const FILTER_RE = Object.keys(FILTER_DOCS).join("|");

function registerNp(monaco: MonacoApi) {
  monaco.languages.register({ id: "np", extensions: [".np"] });

  monaco.languages.setLanguageConfiguration("np", {
    comments: { blockComment: ["<!--", "-->"] },
    brackets: [
      ["{", "}"],
      ["(", ")"],
      ["[", "]"],
    ],
    autoClosingPairs: [
      { open: "{", close: "}" },
      { open: "(", close: ")" },
      { open: "[", close: "]" },
      { open: '"', close: '"', notIn: ["string"] },
      { open: "'", close: "'", notIn: ["string"] },
      { open: "`", close: "`", notIn: ["string"] },
      { open: "<!--", close: " -->" },
    ],
    surroundingPairs: [
      { open: "{", close: "}" },
      { open: "(", close: ")" },
      { open: '"', close: '"' },
      { open: "<", close: ">" },
    ],
    wordPattern: /[\w$-]+/,
  });

  // Il markup è HTML/JSX: i tag aprono uno stato "children" che si chiude col tag di chiusura,
  // così il JSX dentro le espressioni (es. in .map) torna all'espressione alla fine.
  monaco.languages.setMonarchTokensProvider("np", {
    defaultToken: "",
    tokenizer: {
      root: [[/^---\s*$/, { token: "comment.doc", next: "@frontmatter" }], { include: "@content" }],
      frontmatter: [
        [/^---\s*$/, { token: "comment.doc", next: "@pop" }],
        [/.*$/, "string"],
      ],
      content: [
        [/<!--/, { token: "comment", next: "@comment" }],
        [/\{/, { token: "delimiter.bracket", next: "@expr" }],
        [/(<\/)([A-Z][\w]*)(\s*>)/, ["delimiter", "type.identifier", { token: "delimiter", next: "@pop" }]],
        [/(<\/)([\w-]+)(\s*>)/, ["delimiter", "tag", { token: "delimiter", next: "@pop" }]],
        [/<\/>/, { token: "delimiter", next: "@pop" }],
        [/<>/, { token: "delimiter", next: "@children" }],
        [/(<)([A-Z][\w]*)/, ["delimiter", { token: "type.identifier", next: "@tag" }]],
        [/(<)([a-z][\w-]*)/, ["delimiter", { token: "tag", next: "@tag" }]],
        [/[^<{]+/, ""],
      ],
      children: [{ include: "@content" }],
      comment: [
        [/-->/, { token: "comment", next: "@pop" }],
        [/[^-]+/, "comment"],
        [/./, "comment"],
      ],
      tag: [
        [/\/>/, { token: "delimiter", next: "@pop" }],
        [/>/, { token: "delimiter", switchTo: "@children" }],
        [/[\w:-]+/, "attribute.name"],
        [/=/, "delimiter"],
        [/"[^"]*"/, "attribute.value"],
        [/'[^']*'/, "attribute.value"],
        [/\{/, { token: "delimiter.bracket", next: "@expr" }],
        [/\s+/, ""],
      ],
      expr: [
        [/\{/, { token: "delimiter.bracket", next: "@expr" }],
        [/\}/, { token: "delimiter.bracket", next: "@pop" }],
        [/<>/, { token: "delimiter", next: "@children" }],
        [/(<)([A-Z][\w]*)/, ["delimiter", { token: "type.identifier", next: "@tag" }]],
        [/(<)([a-z][\w-]*)/, ["delimiter", { token: "tag", next: "@tag" }]],
        [/"([^"\\]|\\.)*"/, "string"],
        [/'([^'\\]|\\.)*'/, "string"],
        [/`/, { token: "string", next: "@template" }],
        [/\d+(\.\d+)?/, "number"],
        [/\b(true|false|null|undefined)\b/, "keyword"],
        [/\b(page|site|props|children)\b/, "variable.predefined"],
        [new RegExp(`\\b(${FILTER_RE})(?=\\s*\\()`), "support.function"],
        [/[a-zA-Z_$][\w$]*/, "identifier"],
        [/=>|===|!==|==|!=|<=|>=|&&|\|\||\?\?|[?:+\-*/%!.<>]/, "operator"],
        [/[\s,()[\]]+/, ""],
      ],
      template: [
        [/\$\{/, { token: "delimiter.bracket", next: "@expr" }],
        [/`/, { token: "string", next: "@pop" }],
        [/[^`$]+/, "string"],
        [/\$/, "string"],
      ],
    },
  });

  const Kind = monaco.languages.CompletionItemKind;
  const Snippet = monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet;
  const md = (value: string) => ({ value });

  /** Campi di `settings` dichiarati nel frontmatter del file aperto (sezioni). */
  function frontmatterSettings(text: string): Record<string, FieldDoc> {
    const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
    if (!match) return {};
    try {
      const meta = JSON.parse(match[1]) as {
        settings?: Record<string, { type?: string; label?: string; help?: string }>;
      };
      return Object.fromEntries(
        Object.entries(meta.settings ?? {}).map(([key, def]) => [
          key,
          { doc: [def.label, def.type && `\`${def.type}\``, def.help].filter(Boolean).join(" · ") || key },
        ]),
      );
    } catch {
      return {}; // frontmatter in scrittura: JSON non ancora valido
    }
  }

  /** Variabili introdotte da `.map(item => …)` prima del cursore, con i campi noti. */
  function mapLocals(text: string) {
    const locals: Record<string, FieldDoc> = {};
    const re = /([\w$.]+(?:\([^)]*\))?)\.(?:map|filter|find|some|every)\(\s*\(?\s*([\w$]+)/g;
    for (const match of text.matchAll(re)) {
      const [, source, name] = match;
      const call = /^(\w+)\(/.exec(source);
      const fields = call
        ? FILTER_DOCS[call[1] as keyof typeof FILTER_DOCS]?.returns
        : docAt(source.split("."), locals)?.item;
      locals[name] = { doc: `Elemento di \`${source}\``, fields };
    }
    return locals;
  }

  monaco.languages.registerCompletionItemProvider("np", {
    triggerCharacters: ["<", ".", " "],
    provideCompletionItems(model, position) {
      const word = model.getWordUntilPosition(position);
      const range = new monaco.Range(position.lineNumber, word.startColumn, position.lineNumber, word.endColumn);
      const before = model.getValueInRange(new monaco.Range(1, 1, position.lineNumber, position.column));
      const line = before.slice(before.lastIndexOf("\n") + 1);
      const locals = mapLocals(before);
      locals.settings = { doc: GLOBAL_DOCS.settings.doc, fields: frontmatterSettings(model.getValue()) };

      // Tag: componenti del core, del tema e HTML.
      if (/<[\w-]*$/.test(line)) {
        return {
          suggestions: [
            ...Object.entries(COMPONENT_DOCS).map(([name, doc]) => ({
              label: name,
              kind: Kind.Class,
              detail: "Componente del core",
              documentation: md(doc.doc),
              insertText: doc.snippet.slice(name.length).replace(/^/, name),
              insertTextRules: Snippet,
              range,
            })),
            ...context.components.map((name) => ({
              label: name,
              kind: Kind.Module,
              detail: `components/${name}.np`,
              insertText: `${name} $1/>`,
              insertTextRules: Snippet,
              range,
            })),
            ...COMMON_TAGS.map((tag) => ({ label: tag, kind: Kind.Property, insertText: tag, range })),
          ],
        };
      }

      // Props di un componente del core: <Image |
      const openTag = /<([A-Z]\w*)\s[^<>]*$/.exec(line);
      if (openTag && /\s$/.test(line) && COMPONENT_DOCS[openTag[1] as keyof typeof COMPONENT_DOCS]) {
        const doc = COMPONENT_DOCS[openTag[1] as keyof typeof COMPONENT_DOCS];
        return {
          suggestions: Object.entries(doc.props).map(([prop, help]) => ({
            label: prop,
            kind: Kind.Property,
            documentation: md(help),
            insertText: `${prop}={$1}`,
            insertTextRules: Snippet,
            range,
          })),
        };
      }

      // Campi: page.translation.|
      const member = /([A-Za-z_$][\w$]*(?:\.[\w$]+)*)\.[\w$]*$/.exec(line);
      if (member) {
        const doc = docAt(member[1].split("."), locals);
        const fields = doc?.fields ?? {};
        const suggestions: Monaco.languages.CompletionItem[] = Object.entries(fields).map(([name, field]) => ({
          label: name,
          kind: field.fields || field.item ? Kind.Module : Kind.Field,
          documentation: md(field.doc),
          insertText: name,
          range,
        }));
        if (doc?.item || !doc) {
          for (const method of ["length", ...ALLOWED_METHODS]) {
            suggestions.push({
              label: method,
              kind: method === "length" ? Kind.Property : Kind.Method,
              insertText:
                method === "map" ? "map(${1:item} => ${2})" : method === "length" ? "length" : `${method}($1)`,
              insertTextRules: Snippet,
              sortText: `z${method}`,
              range,
            });
          }
        }
        return { suggestions };
      }

      // Espressione: variabili e filtri.
      return {
        suggestions: [
          ...Object.entries(GLOBAL_DOCS).map(([name, doc]) => ({
            label: name,
            kind: Kind.Variable,
            documentation: md(doc.doc),
            insertText: name,
            range,
          })),
          ...Object.entries(locals).map(([name, doc]) => ({
            label: name,
            kind: Kind.Variable,
            documentation: md(doc.doc),
            insertText: name,
            range,
          })),
          ...Object.entries(FILTER_DOCS).map(([name, doc]) => ({
            label: name,
            kind: Kind.Function,
            detail: doc.signature,
            documentation: md(doc.doc),
            insertText: doc.snippet,
            insertTextRules: Snippet,
            range,
          })),
        ],
      };
    },
  });

  monaco.languages.registerHoverProvider("np", {
    provideHover(model, position) {
      const word = model.getWordAtPosition(position);
      if (!word) return null;
      const range = new monaco.Range(position.lineNumber, word.startColumn, position.lineNumber, word.endColumn);
      const name = word.word;
      const filter = FILTER_DOCS[name as keyof typeof FILTER_DOCS];
      if (filter) return { range, contents: [{ value: `\`${filter.signature}\`` }, { value: filter.doc }] };
      const component = COMPONENT_DOCS[name as keyof typeof COMPONENT_DOCS];
      if (component) {
        const props = Object.entries(component.props)
          .map(([prop, help]) => `- \`${prop}\`: ${help}`)
          .join("\n");
        return {
          range,
          contents: [{ value: `**<${name}>** componente del core` }, { value: `${component.doc}\n\n${props}` }],
        };
      }
      if (context.components.includes(name))
        return { range, contents: [{ value: `**<${name}>** components/${name}.np` }] };
      // Percorso puntato fino alla parola sotto il cursore: page.translation.title
      const line = model.getLineContent(position.lineNumber).slice(0, word.endColumn - 1);
      const path = /([A-Za-z_$][\w$]*(?:\.[\w$]+)*)$/.exec(line)?.[1];
      const before = model.getValueInRange(new monaco.Range(1, 1, position.lineNumber, word.startColumn));
      const locals = {
        ...mapLocals(before),
        settings: { doc: GLOBAL_DOCS.settings.doc, fields: frontmatterSettings(model.getValue()) },
      };
      const doc = path ? docAt(path.split("."), locals) : null;
      return doc ? { range, contents: [{ value: `\`${path}\`` }, { value: doc.doc }] } : null;
    },
  });
}

/** Nel CSS: completamento dei token del tema (`var(--np-…)`). */
function registerCssTokens(monaco: MonacoApi) {
  monaco.languages.registerCompletionItemProvider("css", {
    triggerCharacters: ["-"],
    provideCompletionItems(model, position) {
      const line = model.getLineContent(position.lineNumber).slice(0, position.column - 1);
      const match = /--[\w-]*$/.exec(line);
      if (!match) return { suggestions: [] };
      const range = new monaco.Range(
        position.lineNumber,
        position.column - match[0].length,
        position.lineNumber,
        position.column,
      );
      return {
        suggestions: context.tokens.map((token) => ({
          label: `--np-${token}`,
          kind: monaco.languages.CompletionItemKind.Variable,
          detail: "Token del tema",
          insertText: `--np-${token}`,
          range,
        })),
      };
    },
  });
}
