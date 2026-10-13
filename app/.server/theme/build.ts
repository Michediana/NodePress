import { createHash } from "node:crypto";
import path from "node:path";
import * as esbuild from "esbuild";
import { transform } from "lightningcss";
import { z } from "zod";
import type { CompiledFile } from "~/lib/theme/ast";
import {
  TEMPLATE_KINDS,
  templatesOfKind,
  templateList,
  type ThemeBuildData,
  type ThemeManifest,
} from "~/lib/theme/manifest";
import { OVERRIDABLE_BLOCKS, walkSections, type SectionSchema, type SectionTree } from "~/lib/theme/sections";
import { compileMarkup, ThemeCompileError, type EmbeddedBlock } from "./compile";
import { compileTailwind, locateInSource, scanCandidates, splitBaseLayer, usesTailwind } from "./tailwind";
import { parseSectionSchema, parseTree } from "./sections";

// Build di un tema: dai sorgenti (percorso → contenuto) a markup compilato, CSS, JS e asset.
// Nessun codice del tema viene eseguito: il markup diventa AST, il JS viene solo impacchettato
// da esbuild per il browser.

export type ThemeSources = Map<string, Buffer>;

export type BuiltAsset = { hash: string; mime: string; content: Buffer };

export type BuildResult = { data: ThemeBuildData; assets: BuiltAsset[] };

export const LAYER_ORDER = "@layer np.reset, np.core, theme, np.overrides;";

/** Estensioni ammesse nei file del tema, con il loro tipo MIME. */
export const THEME_FILE_TYPES: Record<string, string> = {
  ".np": "text/plain",
  ".json": "application/json",
  ".css": "text/css",
  ".js": "text/javascript",
  ".ts": "text/javascript",
  ".md": "text/markdown",
  ".txt": "text/plain",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".avif": "image/avif",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".otf": "font/otf",
};

export { isTextFile } from "~/lib/theme/files";

/** Percorso di un file del tema normalizzato e sicuro (niente `..`, niente percorsi assoluti). */
export function normalizeThemePath(input: string) {
  const clean = path.posix.normalize(input.replace(/\\/g, "/")).replace(/^\/+/, "");
  if (!clean || clean === "." || clean.startsWith("..") || clean.split("/").some((part) => part.startsWith("."))) {
    throw new Error(`Percorso non valido: "${input}".`);
  }
  if (clean.length > 255) throw new Error(`Percorso troppo lungo: "${input}".`);
  if (!THEME_FILE_TYPES[path.posix.extname(clean).toLowerCase()]) {
    throw new Error(`Tipo di file non ammesso: "${input}". Ammessi: ${Object.keys(THEME_FILE_TYPES).join(" ")}.`);
  }
  return clean;
}

const tokenSchema = z.object({
  type: z.enum(["color", "font", "size", "number", "text"]),
  label: z.string().optional(),
  group: z.string().optional(),
  default: z.string(),
});

const manifestSchema = z.object({
  name: z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/, "solo minuscole, numeri e trattini"),
  label: z.string().min(1).max(255),
  version: z.string().optional(),
  description: z.string().optional(),
  author: z.string().optional(),
  templates: z.record(
    z.string().regex(/^[a-z0-9][a-z0-9-]*$/, "solo minuscole, numeri e trattini"),
    z.object({ label: z.string().min(1), kinds: z.array(z.enum(["page", "listing", "item"])).min(1) }),
  ),
  defaults: z.object({ page: z.string(), listing: z.string(), item: z.string() }).partial().optional(),
  tokens: z.record(z.string().regex(/^[a-z][a-z0-9-]*$/, "solo minuscole, numeri e trattini"), tokenSchema).optional(),
});

const hashOf = (content: Buffer | string) => createHash("sha256").update(content).digest("hex").slice(0, 24);

export const assetUrl = (hash: string, ext: string) => `/_np/theme/a/${hash}${ext}`;

const text = (sources: ThemeSources, file: string) => sources.get(file)!.toString("utf8");

export function parseManifest(source: string): ThemeManifest {
  let raw: unknown;
  try {
    raw = JSON.parse(source);
  } catch (error) {
    throw new ThemeCompileError(`JSON non valido: ${(error as Error).message}`, "theme.json", 1, 1);
  }
  const parsed = manifestSchema.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new ThemeCompileError(`${issue.path.join(".") || "manifest"}: ${issue.message}`, "theme.json", 1, 1);
  }
  return parsed.data;
}

/** Custom properties dei token, con i valori di default. */
/** Valore CSS sicuro dentro una dichiarazione: niente graffe, punti e virgola o chiusure di tag. */
export const cssValue = (value: string) => value.replace(/[{};<>]/g, "").trim();

/** Custom properties dei token: default di theme.json, sostituiti dai valori di config/tokens.json. */
function tokensCss(manifest: ThemeManifest, values: Record<string, string>) {
  const entries = Object.entries(manifest.tokens ?? {});
  if (!entries.length) return "";
  const decls = entries.map(([name, token]) => `--np-${name}:${cssValue(values[name] ?? token.default)}`);
  return `:root{${decls.join(";")}}`;
}

/** Valori dei token scelti nell'editor visuale (config/tokens.json). */
function parseTokenValues(sources: ThemeSources, manifest: ThemeManifest): Record<string, string> {
  const file = "config/tokens.json";
  if (!sources.has(file)) return {};
  let raw: unknown;
  try {
    raw = JSON.parse(text(sources, file));
  } catch (error) {
    throw new ThemeCompileError(`JSON non valido: ${(error as Error).message}`, file, 1, 1);
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw))
    throw new ThemeCompileError("Atteso un oggetto { token: valore }.", file, 1, 1);
  const values: Record<string, string> = {};
  for (const [name, value] of Object.entries(raw)) {
    if (!manifest.tokens?.[name])
      throw new ThemeCompileError(`Token "${name}" non dichiarato in theme.json.`, file, 1, 1);
    if (typeof value !== "string") throw new ThemeCompileError(`Token "${name}": atteso un testo.`, file, 1, 1);
    values[name] = value;
  }
  return values;
}

/** Limite dei selettori: il tipo di sezione (stili del tema) o l'id dell'istanza (override). */
type CssScope = { attr: "data-np-section" | "data-np-id"; value: string };

/** Selettore `[attr="valore"]` nel formato dei visitor di lightningcss. */
const scopeAttr = ({ attr, value }: CssScope) => ({
  type: "attribute" as const,
  name: attr,
  operation: { operator: "equal" as const, value, caseSensitivity: "case-sensitive" as const },
});

/**
 * Compila un foglio di stile. Con `scope` ogni selettore viene limitato alla sezione:
 * `.hero` → `[data-np-section="hero"] .hero`, `:scope` → il contenitore stesso.
 */
function compileCss(file: string, source: string, resolveUrl: (url: string) => string | null, scope?: CssScope) {
  const imports: string[] = [];
  const body = source.replace(/@import\s[^;]+;/g, (rule) => {
    imports.push(rule.replace(/;$/, "").trim());
    return rule.replace(/[^\n]/g, " ");
  });
  // I fogli Tailwind di styles/ arrivano qui già compilati: altrove l'import non verrebbe risolto.
  if (usesTailwind(source)) {
    const line = source.slice(0, source.search(/@(import|reference|tailwind)\s/)).split("\n").length;
    throw new ThemeCompileError("Tailwind si usa solo nei fogli in styles/.", file, line, 1);
  }
  const missing: { url: string; line: number; column: number }[] = [];
  try {
    const { code } = transform({
      filename: file,
      code: Buffer.from(body),
      minify: true,
      // Il nesting e la sintassi moderna vengono abbassati per questi browser.
      targets: { chrome: 100 << 16, firefox: 100 << 16, safari: 15 << 16 },
      visitor: {
        ...(scope
          ? {
              Selector(selector) {
                // Le regole annidate (&) ereditano lo scope dalla regola che le contiene.
                if (selector.some((c) => c.type === "nesting")) return selector;
                const attr = scopeAttr(scope);
                const first = selector[0];
                if (first?.type === "pseudo-class" && first.kind === "scope") return [attr, ...selector.slice(1)];
                return [attr, { type: "combinator", value: "descendant" }, ...selector];
              },
            }
          : {}),
        Url(url) {
          const resolved = resolveUrl(url.url);
          if (resolved === null) {
            missing.push({ url: url.url, line: url.loc.line, column: url.loc.column });
            return url;
          }
          return { ...url, url: resolved };
        },
      },
    });
    if (missing.length) {
      const m = missing[0];
      throw new ThemeCompileError(`File "${m.url}" non trovato nel tema.`, file, m.line, m.column);
    }
    return { imports, css: code.toString() };
  } catch (error) {
    if (error instanceof ThemeCompileError) throw error;
    const e = error as Error & { loc?: { line: number; column: number } };
    throw new ThemeCompileError(e.message, file, e.loc?.line ?? 1, e.loc?.column ?? 1);
  }
}

/** Impacchetta il JS del tema; `virtual` aggiunge file che non sono tra i sorgenti (script delle sezioni). */
async function bundleJs(sources: ThemeSources, entry: string, virtual: Map<string, string> = new Map()) {
  const has = (p: string) => sources.has(p) || virtual.has(p);
  const resolveRel = (importer: string, request: string) => {
    const base = path.posix.join(path.posix.dirname(importer), request);
    return [base, `${base}.js`, `${base}.ts`, `${base}/index.js`, `${base}/index.ts`].find(has);
  };
  try {
    const result = await esbuild.build({
      entryPoints: [entry],
      bundle: true,
      write: false,
      format: "esm",
      minify: true,
      target: "es2020",
      logLevel: "silent",
      plugins: [
        {
          name: "nodepress-theme",
          setup(build) {
            build.onResolve({ filter: /.*/ }, (args) => {
              if (args.kind === "entry-point") return { path: args.path, namespace: "theme" };
              if (/^https:\/\//.test(args.path)) return { path: args.path, external: true };
              if (!args.path.startsWith(".")) {
                return {
                  errors: [{ text: `Import "${args.path}" non supportato: usa percorsi relativi o URL https://.` }],
                };
              }
              const resolved = resolveRel(args.importer, args.path);
              if (!resolved) return { errors: [{ text: `File "${args.path}" non trovato nel tema.` }] };
              return { path: resolved, namespace: "theme" };
            });
            build.onLoad({ filter: /.*/, namespace: "theme" }, (args) => {
              const ext = path.posix.extname(args.path);
              const loader = ext === ".ts" ? "ts" : ext === ".json" ? "json" : ext === ".css" ? "text" : "js";
              return { contents: virtual.get(args.path) ?? text(sources, args.path), loader };
            });
          },
        },
      ],
    });
    return result.outputFiles[0].text;
  } catch (error) {
    const failure = error as esbuild.BuildFailure;
    const first = failure.errors?.[0];
    if (!first) throw error;
    throw new ThemeCompileError(
      first.text,
      first.location?.file ?? entry,
      first.location?.line ?? 1,
      (first.location?.column ?? 0) + 1,
    );
  }
}

/** Compila tutti i sorgenti del tema. Lancia `ThemeCompileError` al primo errore. */
export async function buildTheme(sources: ThemeSources): Promise<BuildResult> {
  if (!sources.has("theme.json")) throw new ThemeCompileError("Manca il file theme.json.", "theme.json", 1, 1);
  const manifest = parseManifest(text(sources, "theme.json"));
  const files = [...sources.keys()].sort();
  const assets: BuiltAsset[] = [];

  // Asset statici: tutto ciò che sta in assets/.
  const assetUrls: Record<string, string> = {};
  for (const file of files.filter((f) => f.startsWith("assets/"))) {
    const content = sources.get(file)!;
    const ext = path.posix.extname(file).toLowerCase();
    const hash = hashOf(content);
    assets.push({ hash, mime: THEME_FILE_TYPES[ext], content });
    assetUrls[file] = assetUrl(hash, ext);
  }

  // Markup: template, componenti, sezioni e blocchi del contenuto.
  const compiled: Record<string, CompiledFile> = {};
  const schemas: Record<string, SectionSchema> = {};
  const sectionStyles: { file: string; type: string; block: EmbeddedBlock }[] = [];
  const sectionScripts = new Map<string, string>();
  for (const file of files.filter((f) => f.endsWith(".np"))) {
    const { meta, style, script, ...result } = compileMarkup(file, text(sources, file));
    compiled[file] = result;
    const isSection = /^sections\/[a-z0-9][a-z0-9-]*\.np$/.test(file);
    if (file.startsWith("sections/") && !isSection) {
      throw new ThemeCompileError(
        "Le sezioni stanno direttamente in sections/, con un nome in minuscolo (es. sections/hero.np).",
        file,
        1,
        1,
      );
    }
    if ((style || script) && !isSection) {
      throw new ThemeCompileError(
        "<style> e <script> sono ammessi solo nelle sezioni: usa styles/ e scripts/.",
        file,
        (style ?? script)!.line,
        1,
      );
    }
    if (isSection) {
      const schema = parseSectionSchema(file, meta);
      schemas[schema.name] = schema;
      if (style) sectionStyles.push({ file, type: schema.name, block: style });
      // Le righe vuote iniziali allineano gli errori di esbuild alle righe del file .np.
      if (script) sectionScripts.set(`${file}.js`, "\n".repeat(script.line - 1) + script.content);
    } else if (meta !== null) {
      throw new ThemeCompileError("Il frontmatter è ammesso solo nelle sezioni.", file, 1, 1);
    }
    if (file.startsWith("blocks/")) {
      const block = file.slice("blocks/".length, -".np".length);
      if (!(OVERRIDABLE_BLOCKS as readonly string[]).includes(block)) {
        throw new ThemeCompileError(
          `Blocco "${block}" non ridisegnabile. Ammessi: ${OVERRIDABLE_BLOCKS.join(", ")}.`,
          file,
          1,
          1,
        );
      }
    }
  }
  const components = new Set(
    Object.keys(compiled)
      .filter((f) => /^components\/[^/]+\.np$/.test(f))
      .map((f) => f.slice("components/".length, -".np".length)),
  );

  // Alberi di sezioni: template JSON e gruppi.
  const trees: Record<string, SectionTree> = {};
  for (const file of files.filter((f) => /^(templates|groups)\/[^/]+\.json$/.test(f))) {
    trees[file] = parseTree(file, text(sources, file), schemas, components);
  }

  const templates = templateList(manifest);
  for (const tpl of templates) {
    const np = compiled[`templates/${tpl.name}.np`];
    const json = trees[`templates/${tpl.name}.json`];
    if (np && json) {
      throw new ThemeCompileError(
        `Il template "${tpl.name}" esiste sia come .np sia come .json: tienine uno.`,
        `templates/${tpl.name}.json`,
        1,
        1,
      );
    }
    if (!np && !json) {
      throw new ThemeCompileError(
        `Il template "${tpl.name}" è dichiarato ma manca templates/${tpl.name}.np (o .json).`,
        "theme.json",
        1,
        1,
      );
    }
  }
  for (const kind of TEMPLATE_KINDS) {
    const ofKind = templatesOfKind(templates, kind);
    if (!ofKind.length) throw new ThemeCompileError(`Nessun template per il tipo "${kind}".`, "theme.json", 1, 1);
    const preferred = manifest.defaults?.[kind];
    if (preferred && !ofKind.some((t) => t.name === preferred)) {
      throw new ThemeCompileError(
        `defaults.${kind}: "${preferred}" non è un template di tipo "${kind}".`,
        "theme.json",
        1,
        1,
      );
    }
  }
  for (const file of Object.values(compiled)) {
    for (const name of file.uses) {
      if (!components.has(name)) {
        throw new ThemeCompileError(`Componente <${name}> non trovato: manca components/${name}.np.`, file.path, 1, 1);
      }
    }
    for (const name of file.groups) {
      if (!trees[`groups/${name}.json`]) {
        throw new ThemeCompileError(`Gruppo "${name}" non trovato: manca groups/${name}.json.`, file.path, 1, 1);
      }
    }
  }

  // CSS: tutti i file in styles/, in ordine alfabetico, nel layer "theme". Quelli che importano
  // "tailwindcss" passano prima da Tailwind, con le classi usate in tutto il tema.
  const imports: string[] = [];
  const styles: string[] = [];
  // Preflight e @layer base di Tailwind: nel layer np.reset, sotto gli stili del core.
  const resets: string[] = [];
  let candidates: string[] | null = null;
  for (const file of files.filter((f) => f.startsWith("styles/") && f.endsWith(".css"))) {
    const resolveUrl = (url: string) => {
      if (/^(https?:|data:|#|\/)/i.test(url)) return url;
      const target = path.posix.normalize(path.posix.join(path.posix.dirname(file), url.replace(/[?#].*$/, "")));
      return assetUrls[target] ?? null;
    };
    const original = text(sources, file);
    let result: ReturnType<typeof compileCss>;
    if (usesTailwind(original)) {
      candidates ??= scanCandidates(sources);
      try {
        const { base, rest } = splitBaseLayer(await compileTailwind(file, original, sources, candidates));
        if (base) resets.push(compileCss(file, base, resolveUrl).css);
        result = compileCss(file, rest, resolveUrl);
      } catch (error) {
        throw error instanceof ThemeCompileError ? locateInSource(error, original) : error;
      }
    } else {
      result = compileCss(file, original, resolveUrl);
    }
    imports.push(...result.imports.map((rule) => (/\blayer\b/.test(rule) ? rule : `${rule} layer(theme)`) + ";"));
    styles.push(result.css);
  }
  // Stili delle sezioni, limitati alla sezione, dopo i fogli globali.
  for (const { file, type, block } of sectionStyles) {
    const resolveUrl = (url: string) => {
      if (/^(https?:|data:|#|\/)/i.test(url)) return url;
      const target = path.posix.normalize(path.posix.join("sections", url.replace(/[?#].*$/, "")));
      return assetUrls[target] ?? null;
    };
    const result = compileCss(file, "\n".repeat(block.line - 1) + block.content, resolveUrl, {
      attr: "data-np-section",
      value: type,
    });
    imports.push(...result.imports.map((rule) => (/\blayer\b/.test(rule) ? rule : `${rule} layer(theme)`) + ";"));
    styles.push(result.css);
  }
  // Override dell'editor visuale: CSS globale (config/custom.css) e CSS delle singole istanze.
  // Stanno nel layer np.overrides, che vince su tutto il CSS del tema.
  const overrides: string[] = [];
  const resolveRoot = (url: string) => {
    if (/^(https?:|data:|#|\/)/i.test(url)) return url;
    return assetUrls[path.posix.normalize(url.replace(/^\.\//, "").replace(/[?#].*$/, ""))] ?? null;
  };
  if (sources.has("config/custom.css")) {
    const result = compileCss("config/custom.css", text(sources, "config/custom.css"), (url) =>
      resolveRoot(url.replace(/^\.\.\//, "")),
    );
    imports.push(
      ...result.imports.map((rule) => (/\blayer\b/.test(rule) ? rule : `${rule} layer(np.overrides)`) + ";"),
    );
    overrides.push(result.css);
  }
  for (const [file, tree] of Object.entries(trees)) {
    walkSections(tree.sections, (node) => {
      if (!node.css) return;
      try {
        overrides.push(compileCss(file, node.css, resolveRoot, { attr: "data-np-id", value: node.id }).css);
      } catch (error) {
        // Il CSS sta dentro il JSON: la riga del file non servirebbe, conta la sezione.
        const e = error as ThemeCompileError;
        throw new ThemeCompileError(`CSS della sezione "${node.id}": ${e.message.replace(/^.*? — /, "")}`, file, 1, 1);
      }
    });
  }

  let css: string | null = null;
  const tokens = tokensCss(manifest, parseTokenValues(sources, manifest));
  if (styles.length || tokens || overrides.length) {
    const resetLayer = resets.length ? `@layer np.reset{${resets.join("")}}` : "";
    const overrideLayer = overrides.length ? `@layer np.overrides{${overrides.join("")}}` : "";
    const content = Buffer.from(
      `${LAYER_ORDER}${imports.join("")}${resetLayer}@layer theme{${tokens}${styles.join("")}}${overrideLayer}`,
    );
    const hash = hashOf(content);
    assets.push({ hash, mime: "text/css; charset=utf-8", content });
    css = assetUrl(hash, ".css");
  }

  // JS: scripts/main.js (o .ts) più gli script delle sezioni, solo per il browser.
  let js: string | null = null;
  const main = ["scripts/main.js", "scripts/main.ts"].find((f) => sources.has(f));
  if (main || sectionScripts.size) {
    const entry = "__entry__.js";
    const imports = [...(main ? [main] : []), ...sectionScripts.keys()].map((f) => `import "./${f}";`);
    const virtual = new Map([...sectionScripts, [entry, imports.join("\n")]]);
    const content = Buffer.from(await bundleJs(sources, entry, virtual));
    const hash = hashOf(content);
    assets.push({ hash, mime: "text/javascript; charset=utf-8", content });
    js = assetUrl(hash, ".js");
  }

  const sourceHash = hashOf(files.map((f) => `${f}\0${hashOf(sources.get(f)!)}`).join("\n"));
  return {
    data: {
      manifest,
      files: compiled,
      schemas,
      trees,
      css,
      js,
      assets: assetUrls,
      assetHashes: [...new Set(assets.map((a) => a.hash))],
      sourceHash,
    },
    assets,
  };
}

/**
 * Controlla un singolo file senza salvarlo né ricompilare il tema: per gli errori mentre si scrive.
 * Non verifica i riferimenti ad altri file (componenti, asset), che la build completa controlla.
 */
export async function lintThemeFile(file: string, source: string): Promise<ThemeCompileError | null> {
  try {
    const ext = path.posix.extname(file).toLowerCase();
    if (ext === ".np") {
      const { meta, style, script } = compileMarkup(file, source);
      if (file.startsWith("sections/")) {
        const schema = parseSectionSchema(file, meta);
        if (style)
          compileCss(file, "\n".repeat(style.line - 1) + style.content, (url) => url, {
            attr: "data-np-section",
            value: schema.name,
          });
        if (script) {
          try {
            await esbuild.transform("\n".repeat(script.line - 1) + script.content, {
              loader: "js",
              sourcefile: file,
              logLevel: "silent",
            });
          } catch (error) {
            const first = (error as esbuild.TransformFailure).errors?.[0];
            if (!first) throw error;
            throw new ThemeCompileError(first.text, file, first.location?.line ?? 1, (first.location?.column ?? 0) + 1);
          }
        }
      } else if (style || script) {
        throw new ThemeCompileError(
          "<style> e <script> sono ammessi solo nelle sezioni: usa styles/ e scripts/.",
          file,
          (style ?? script)!.line,
          1,
        );
      }
    } else if (file === "theme.json") parseManifest(source);
    else if (ext === ".css" && usesTailwind(source)) {
      try {
        compileCss(file, await compileTailwind(file, source, null, []), (url) => url);
      } catch (error) {
        throw error instanceof ThemeCompileError ? locateInSource(error, source) : error;
      }
    } else if (ext === ".css") compileCss(file, source, (url) => url);
    else if (ext === ".js" || ext === ".ts") {
      try {
        await esbuild.transform(source, { loader: ext === ".ts" ? "ts" : "js", sourcefile: file, logLevel: "silent" });
      } catch (error) {
        const first = (error as esbuild.TransformFailure).errors?.[0];
        if (!first) throw error;
        throw new ThemeCompileError(first.text, file, first.location?.line ?? 1, (first.location?.column ?? 0) + 1);
      }
    }
    return null;
  } catch (error) {
    if (error instanceof ThemeCompileError) return error;
    throw error;
  }
}
