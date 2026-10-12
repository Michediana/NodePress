import { createHash } from "node:crypto";
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { transform } from "lightningcss";
import { componentPath, type CompiledFile, type ThemeBundle } from "~/lib/theme/ast";
import { compileMarkup, ThemeCompileError } from "./compile";

// Caricamento del tema attivo: legge i file da `themes/<nome>/`, compila markup e CSS
// e tiene il risultato in cache finché i file non cambiano (modifiche visibili senza riavvio).
// Nella fase 2.2 i file passeranno dal disco al DB, con build bozza/pubblicata.

const THEMES_DIR = path.resolve(process.env.THEMES_DIR ?? "themes");

export const LAYER_ORDER = "@layer np.reset, np.core, theme, np.overrides;";

export type ThemeManifest = {
  name: string;
  label: string;
  version?: string;
};

export type CompiledTheme = {
  manifest: ThemeManifest;
  files: Record<string, CompiledFile>;
  css: string;
  cssHash: string;
};

type CacheEntry = { signature: string; theme?: CompiledTheme; error?: Error };

const cache = new Map<string, CacheEntry>();

/** Nome del tema attivo. Per ora fisso: nella 2.2 arriverà dalle impostazioni. */
export function activeThemeName() {
  return "default";
}

async function listFiles(dir: string, base = ""): Promise<string[]> {
  const entries = await readdir(path.join(dir, base), { withFileTypes: true });
  const out: string[] = [];
  for (const entry of entries) {
    if (entry.name.startsWith(".")) continue;
    const rel = base ? `${base}/${entry.name}` : entry.name;
    if (entry.isDirectory()) out.push(...(await listFiles(dir, rel)));
    else out.push(rel);
  }
  return out.sort();
}

/** Firma dei file del tema (percorso, dimensione, data di modifica): cambia a ogni salvataggio. */
async function signatureOf(dir: string, files: string[]) {
  const stats = await Promise.all(files.map((f) => stat(path.join(dir, f))));
  return files.map((f, i) => `${f}:${stats[i].size}:${stats[i].mtimeMs}`).join("|");
}

/** Compila un file CSS del tema; gli `@import` vengono separati per finire in testa al foglio. */
function compileCss(file: string, source: string) {
  const imports: string[] = [];
  const body = source.replace(/@import\s[^;]+;/g, (rule) => {
    imports.push(rule.replace(/;$/, "").trim());
    return rule.replace(/[^\n]/g, " ");
  });
  try {
    const { code } = transform({
      filename: file,
      code: Buffer.from(body),
      minify: true,
      // Il nesting e la sintassi moderna vengono abbassati per questi browser.
      targets: { chrome: 100 << 16, firefox: 100 << 16, safari: 15 << 16 },
    });
    return { imports, css: code.toString() };
  } catch (error) {
    const e = error as Error & { loc?: { line: number; column: number } };
    throw new ThemeCompileError(e.message, file, e.loc?.line ?? 1, e.loc?.column ?? 1);
  }
}

async function compileTheme(dir: string, files: string[]): Promise<CompiledTheme> {
  const manifest = JSON.parse(await readFile(path.join(dir, "theme.json"), "utf8")) as ThemeManifest;
  const compiled: Record<string, CompiledFile> = {};
  const imports: string[] = [];
  const styles: string[] = [];

  for (const file of files) {
    if (file.endsWith(".np")) {
      const { meta: _meta, ...result } = compileMarkup(file, await readFile(path.join(dir, file), "utf8"));
      compiled[file] = result;
    } else if (file.startsWith("styles/") && file.endsWith(".css")) {
      const result = compileCss(file, await readFile(path.join(dir, file), "utf8"));
      imports.push(...result.imports.map((rule) => (/\blayer\b/.test(rule) ? rule : `${rule} layer(theme)`) + ";"));
      styles.push(result.css);
    }
  }

  // Il CSS del tema vive nel layer "theme": vince sul core, perde sugli override del pannello.
  const css = `${LAYER_ORDER}${imports.join("")}@layer theme{${styles.join("")}}`;
  const cssHash = createHash("sha256").update(css).digest("hex").slice(0, 12);
  return { manifest, files: compiled, css, cssHash };
}

/** Tema compilato, dalla cache se i file non sono cambiati. Lancia l'errore di compilazione, se c'è. */
export async function getTheme(name = activeThemeName()): Promise<CompiledTheme> {
  const dir = path.join(THEMES_DIR, name);
  const files = await listFiles(dir);
  const signature = await signatureOf(dir, files);
  let entry = cache.get(name);
  if (entry?.signature !== signature) {
    try {
      entry = { signature, theme: await compileTheme(dir, files) };
    } catch (error) {
      entry = { signature, error: error as Error };
    }
    cache.set(name, entry);
  }
  if (entry.error) throw entry.error;
  return entry.theme!;
}

/** Il file d'ingresso e tutti i componenti del tema che usa, anche indirettamente. */
export function bundleFor(theme: CompiledTheme, entry: string): ThemeBundle {
  const files: Record<string, CompiledFile> = {};
  const visit = (file: string) => {
    const compiled = theme.files[file];
    if (!compiled || files[file]) return;
    files[file] = compiled;
    for (const name of compiled.uses) visit(componentPath(name));
  };
  visit(entry);
  return { entry, files };
}

/** Bundle del template indicato, con ripiego su `templates/default.np`. */
export function templateBundle(theme: CompiledTheme, template: string) {
  const file = `templates/${template}.np`;
  return bundleFor(theme, theme.files[file] ? file : "templates/default.np");
}

export const themeCssHref = (theme: CompiledTheme) => `/_np/theme/${theme.cssHash}.css`;
