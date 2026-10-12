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
import { compileMarkup, ThemeCompileError } from "./compile";

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

export const TEXT_EXTENSIONS = new Set([".np", ".json", ".css", ".js", ".ts", ".md", ".txt", ".svg"]);

export const isTextFile = (file: string) => TEXT_EXTENSIONS.has(path.posix.extname(file).toLowerCase());

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
function tokensCss(manifest: ThemeManifest) {
  const entries = Object.entries(manifest.tokens ?? {});
  if (!entries.length) return "";
  // Il valore viene da theme.json: niente graffe o punti e virgola che uscirebbero dalla dichiarazione.
  const decls = entries.map(([name, token]) => `--np-${name}:${token.default.replace(/[{};]/g, "")}`);
  return `:root{${decls.join(";")}}`;
}

function compileCss(file: string, source: string, resolveUrl: (url: string) => string | null) {
  const imports: string[] = [];
  const body = source.replace(/@import\s[^;]+;/g, (rule) => {
    imports.push(rule.replace(/;$/, "").trim());
    return rule.replace(/[^\n]/g, " ");
  });
  const missing: { url: string; line: number; column: number }[] = [];
  try {
    const { code } = transform({
      filename: file,
      code: Buffer.from(body),
      minify: true,
      // Il nesting e la sintassi moderna vengono abbassati per questi browser.
      targets: { chrome: 100 << 16, firefox: 100 << 16, safari: 15 << 16 },
      visitor: {
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

async function bundleJs(sources: ThemeSources, entry: string) {
  const resolveRel = (importer: string, request: string) => {
    const base = path.posix.join(path.posix.dirname(importer), request);
    return [base, `${base}.js`, `${base}.ts`, `${base}/index.js`, `${base}/index.ts`].find((p) => sources.has(p));
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
              return { contents: text(sources, args.path), loader };
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

  // Markup.
  const compiled: Record<string, CompiledFile> = {};
  for (const file of files.filter((f) => f.endsWith(".np"))) {
    const { meta: _meta, ...result } = compileMarkup(file, text(sources, file));
    compiled[file] = result;
  }
  const templates = templateList(manifest);
  for (const tpl of templates) {
    if (!compiled[`templates/${tpl.name}.np`]) {
      throw new ThemeCompileError(
        `Il template "${tpl.name}" è dichiarato ma manca templates/${tpl.name}.np.`,
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
      if (!compiled[`components/${name}.np`]) {
        throw new ThemeCompileError(`Componente <${name}> non trovato: manca components/${name}.np.`, file.path, 1, 1);
      }
    }
  }

  // CSS: tutti i file in styles/, in ordine alfabetico, nel layer "theme".
  const imports: string[] = [];
  const styles: string[] = [];
  for (const file of files.filter((f) => f.startsWith("styles/") && f.endsWith(".css"))) {
    const resolveUrl = (url: string) => {
      if (/^(https?:|data:|#|\/)/i.test(url)) return url;
      const target = path.posix.normalize(path.posix.join(path.posix.dirname(file), url.replace(/[?#].*$/, "")));
      return assetUrls[target] ?? null;
    };
    const result = compileCss(file, text(sources, file), resolveUrl);
    imports.push(...result.imports.map((rule) => (/\blayer\b/.test(rule) ? rule : `${rule} layer(theme)`) + ";"));
    styles.push(result.css);
  }
  let css: string | null = null;
  const tokens = tokensCss(manifest);
  if (styles.length || tokens) {
    const content = Buffer.from(`${LAYER_ORDER}${imports.join("")}@layer theme{${tokens}${styles.join("")}}`);
    const hash = hashOf(content);
    assets.push({ hash, mime: "text/css; charset=utf-8", content });
    css = assetUrl(hash, ".css");
  }

  // JS: punto d'ingresso scripts/main.js (o .ts), solo per il browser.
  let js: string | null = null;
  const entry = ["scripts/main.js", "scripts/main.ts"].find((f) => sources.has(f));
  if (entry) {
    const content = Buffer.from(await bundleJs(sources, entry));
    const hash = hashOf(content);
    assets.push({ hash, mime: "text/javascript; charset=utf-8", content });
    js = assetUrl(hash, ".js");
  }

  const sourceHash = hashOf(files.map((f) => `${f}\0${hashOf(sources.get(f)!)}`).join("\n"));
  return {
    data: {
      manifest,
      files: compiled,
      css,
      js,
      assets: assetUrls,
      assetHashes: [...new Set(assets.map((a) => a.hash))],
      sourceHash,
    },
    assets,
  };
}
